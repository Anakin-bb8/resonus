/**
 * Podcasts kept on the device, one SQLite database per profile. Not in the
 * download catalog, which can be emptied for space; a show the user opened is
 * theirs, so it lives here and not in a disposable cache.
 *
 * `podcast_feeds` is what gets refreshed; `podcast_channels` is what was read
 * from each feed, including the error when the last read failed. `podcast_favorites`
 * is the user's own hearts: a row is a favorited channel (`kind = 'channel'`,
 * `channel_id` its own id) or a favorited episode (`kind = 'episode'`, `channel_id`
 * the show it belongs to) — `channel_id` names the show either way.
 */
import * as FileSystem from 'expo-file-system/legacy';
import * as SQLite from 'expo-sqlite';

import type { PodcastChannel, PodcastEpisode } from '@/api/subsonic';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA journal_size_limit = 524288;
CREATE TABLE IF NOT EXISTS podcast_channels (
  id TEXT PRIMARY KEY NOT NULL,
  feed_url TEXT,
  title TEXT NOT NULL,
  image_url TEXT,
  episode_count INTEGER NOT NULL DEFAULT 0,
  last_published_at INTEGER,
  refreshed_at INTEGER,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS podcast_channels_order
  ON podcast_channels(last_published_at DESC, title);
CREATE TABLE IF NOT EXISTS podcast_episodes (
  id TEXT PRIMARY KEY NOT NULL,
  channel_id TEXT NOT NULL,
  published_at INTEGER,
  duration INTEGER,
  url TEXT,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS podcast_episodes_channel
  ON podcast_episodes(channel_id, published_at DESC);
CREATE TABLE IF NOT EXISTS podcast_feeds (
  feed_url TEXT PRIMARY KEY NOT NULL,
  added_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS podcast_favorites (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,
  channel_id TEXT,
  favorited_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS podcast_favorites_order
  ON podcast_favorites(kind, favorited_at DESC);
CREATE TABLE IF NOT EXISTS podcast_downloads (
  episode_id TEXT PRIMARY KEY NOT NULL,
  channel_id TEXT NOT NULL,
  file TEXT NOT NULL,
  bytes INTEGER,
  downloaded_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS podcast_downloads_channel
  ON podcast_downloads(channel_id, downloaded_at DESC);
`;

const ROOT = `${FileSystem.documentDirectory}podcasts/`;

const open = new Map<string, Promise<SQLite.SQLiteDatabase>>();

/** Where one profile's podcasts are kept. */
export function podcastDbDir(scope: string): string {
  return `${ROOT}${scope}/`;
}

async function openDb(dir: string): Promise<SQLite.SQLiteDatabase> {
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
  const db = await SQLite.openDatabaseAsync('podcasts.db', {}, dir.replace(/^file:\/\//, ''));
  await db.execAsync(SCHEMA);
  return db;
}

function podcastDb(scope: string): Promise<SQLite.SQLiteDatabase> {
  const dir = podcastDbDir(scope);
  const existing = open.get(dir);
  if (existing) return existing;
  // A failure is not remembered, so the next caller tries again.
  const handle: Promise<SQLite.SQLiteDatabase> = openDb(dir).catch((e) => {
    if (open.get(dir) === handle) open.delete(dir);
    throw e;
  });
  open.set(dir, handle);
  return handle;
}

/** Closes one profile's database, for when its folder is about to go. */
export async function closePodcastDb(scope: string): Promise<void> {
  const dir = podcastDbDir(scope);
  const handle = open.get(dir);
  if (!handle) return;
  open.delete(dir);
  await handle.then((db) => db.closeAsync()).catch(() => {});
}

export async function saveChannel(scope: string, channel: PodcastChannel): Promise<void> {
  const db = await podcastDb(scope);
  await db.runAsync(
    `INSERT OR REPLACE INTO podcast_channels
       (id, feed_url, title, image_url, episode_count, last_published_at, refreshed_at, data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      channel.id,
      channel.feedUrl ?? null,
      channel.title,
      channel.imageUrl ?? null,
      channel.episodeCount ?? 0,
      channel.lastPublishedAt ?? null,
      channel.refreshedAt ?? null,
      JSON.stringify(channel),
    ],
  );
}

/**
 * A channel's episodes, replaced by what its feed lists now: an episode the
 * publisher pulled goes too.
 */
export async function replaceEpisodes(
  scope: string,
  channelId: string,
  episodes: PodcastEpisode[],
): Promise<void> {
  const db = await podcastDb(scope);
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM podcast_episodes WHERE channel_id = ?', [channelId]);
    for (const e of episodes) {
      await db.runAsync(
        `INSERT OR REPLACE INTO podcast_episodes
           (id, channel_id, published_at, duration, url, data)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          e.id,
          e.channelId,
          e.publishedAt ?? null,
          e.duration ?? null,
          e.url ?? null,
          JSON.stringify(e),
        ],
      );
    }
  });
}

export async function listChannels(scope: string): Promise<PodcastChannel[]> {
  const db = await podcastDb(scope);
  const rows = await db.getAllAsync<{ data: string }>(
    `SELECT data FROM podcast_channels
     ORDER BY COALESCE(last_published_at, 0) DESC, title COLLATE NOCASE ASC`,
  );
  return rows.map((r) => JSON.parse(r.data) as PodcastChannel);
}

export async function getChannel(
  scope: string,
  id: string,
): Promise<PodcastChannel | undefined> {
  const db = await podcastDb(scope);
  const row = await db.getFirstAsync<{ data: string }>(
    'SELECT data FROM podcast_channels WHERE id = ?',
    [id],
  );
  return row ? (JSON.parse(row.data) as PodcastChannel) : undefined;
}

/** The episodes of a channel, newest first, capped: old feeds list thousands. */
export async function listEpisodes(
  scope: string,
  channelId: string,
  limit = 200,
): Promise<PodcastEpisode[]> {
  const db = await podcastDb(scope);
  const rows = await db.getAllAsync<{ data: string }>(
    `SELECT data FROM podcast_episodes
     WHERE channel_id = ?
     ORDER BY COALESCE(published_at, 0) DESC, id ASC
     LIMIT ?`,
    [channelId, limit],
  );
  return rows.map((r) => JSON.parse(r.data) as PodcastEpisode);
}

/** One episode together with the show it belongs to, for a row that shows both. */
export interface RecentEpisode {
  episode: PodcastEpisode;
  channel: PodcastChannel;
}

/** The newest playable episodes across every channel, each with its channel. */
export async function listRecentEpisodes(scope: string, limit = 20): Promise<RecentEpisode[]> {
  const db = await podcastDb(scope);
  const rows = await db.getAllAsync<{ episode: string; channel: string }>(
    `SELECT e.data AS episode, c.data AS channel
     FROM podcast_episodes e
     JOIN podcast_channels c ON c.id = e.channel_id
     WHERE e.url IS NOT NULL AND e.url <> ''
     ORDER BY COALESCE(e.published_at, 0) DESC, e.id ASC
     LIMIT ?`,
    [limit],
  );
  return rows.map((r) => ({
    episode: JSON.parse(r.episode) as PodcastEpisode,
    channel: JSON.parse(r.channel) as PodcastChannel,
  }));
}

/** Remembers a feed; one already there keeps its place in the order. */
export async function addFeed(scope: string, feedUrl: string): Promise<void> {
  const db = await podcastDb(scope);
  await db.runAsync('INSERT OR IGNORE INTO podcast_feeds (feed_url, added_at) VALUES (?, ?)', [
    feedUrl,
    Date.now(),
  ]);
}

/** Every feed kept on the device, oldest first. */
export async function listFeeds(scope: string): Promise<string[]> {
  const db = await podcastDb(scope);
  const rows = await db.getAllAsync<{ feed_url: string }>(
    'SELECT feed_url FROM podcast_feeds ORDER BY added_at ASC',
  );
  return rows.map((r) => r.feed_url);
}

/**
 * Hearts on/off. A favorite is the user's own, so it lives here and not in the
 * server's starring: `kind` says whether the id is a show or one of its episodes,
 * and `channel_id` is the show either way — the id for a channel, its show for an
 * episode — so one row can find the show an episode belongs to. Returns whether
 * the item is favorited now.
 */
export async function toggleFavorite(
  scope: string,
  id: string,
  kind: 'channel' | 'episode',
  channelId: string,
): Promise<boolean> {
  const db = await podcastDb(scope);
  const existing = await db.getFirstAsync<{ favorited_at: number }>(
    'SELECT favorited_at FROM podcast_favorites WHERE id = ?',
    [id],
  );
  if (existing) {
    await db.runAsync('DELETE FROM podcast_favorites WHERE id = ?', [id]);
    return false;
  }
  await db.runAsync(
    'INSERT INTO podcast_favorites (id, kind, channel_id, favorited_at) VALUES (?, ?, ?, ?)',
    [id, kind, channelId, Date.now()],
  );
  return true;
}

/** The ids the user has hearted, for a row to show its heart without a query each. */
export async function favoriteIds(scope: string): Promise<Set<string>> {
  const db = await podcastDb(scope);
  const rows = await db.getAllAsync<{ id: string }>(
    'SELECT id FROM podcast_favorites',
    [],
  );
  return new Set(rows.map((r) => r.id));
}

/** The favorited shows, most recently hearted first. */
export async function listFavoriteChannels(scope: string): Promise<PodcastChannel[]> {
  const db = await podcastDb(scope);
  const rows = await db.getAllAsync<{ data: string }>(
    `SELECT c.data FROM podcast_favorites f
     JOIN podcast_channels c ON c.id = f.id
     WHERE f.kind = 'channel'
     ORDER BY f.favorited_at DESC`,
  );
  return rows.map((r) => JSON.parse(r.data) as PodcastChannel);
}

/** The favorited episodes, each with its show, most recently hearted first. */
export async function listFavoriteEpisodes(scope: string, limit = 100): Promise<RecentEpisode[]> {
  const db = await podcastDb(scope);
  const rows = await db.getAllAsync<{ episode: string; channel: string }>(
    `SELECT e.data AS episode, c.data AS channel
     FROM podcast_favorites f
     JOIN podcast_episodes e ON e.id = f.id
     JOIN podcast_channels c ON c.id = e.channel_id
     WHERE f.kind = 'episode'
     ORDER BY f.favorited_at DESC
     LIMIT ?`,
    [limit],
  );
  return rows.map((r) => ({
    episode: JSON.parse(r.episode) as PodcastEpisode,
    channel: JSON.parse(r.channel) as PodcastChannel,
  }));
}

/**
 * A downloaded episode: its file on disk, remembered so a cold start can hand
 * the same path back to the player. `channel_id` lets a whole show's downloads
 * be counted and cleared together.
 */
export async function saveDownload(
  scope: string,
  episode: { id: string; channelId: string },
  fileUri: string,
  bytes: number | undefined,
): Promise<void> {
  const db = await podcastDb(scope);
  await db.runAsync(
    `INSERT OR REPLACE INTO podcast_downloads
       (episode_id, channel_id, file, bytes, downloaded_at)
     VALUES (?, ?, ?, ?, ?)`,
    [episode.id, episode.channelId, fileUri, bytes ?? null, Date.now()],
  );
}

/** Drops downloads from the record (the file itself is unlinked by the caller). */
export async function dropDownloads(scope: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await podcastDb(scope);
  for (const id of ids) {
    await db.runAsync('DELETE FROM podcast_downloads WHERE episode_id = ?', [id]);
  }
}

/** Every downloaded episode's file, keyed by episode id, for the player's map. */
export async function listDownloads(scope: string): Promise<Record<string, string>> {
  const db = await podcastDb(scope);
  const rows = await db.getAllAsync<{ id: string; file: string }>(
    'SELECT episode_id AS id, file FROM podcast_downloads',
    [],
  );
  const out: Record<string, string> = {};
  for (const r of rows) out[r.id] = r.file;
  return out;
}

/**
 * What the downloaded episodes take, added up by the database: the size was
 * written down when each file landed, so this is a sum, not a walk.
 */
export async function downloadedBytes(scope: string): Promise<number> {
  const db = await podcastDb(scope);
  const row = await db.getFirstAsync<{ total: number | null }>(
    'SELECT SUM(bytes) AS total FROM podcast_downloads',
  );
  return row?.total ?? 0;
}

/**
 * Forgets every downloaded episode in every profile's database, and closes the
 * handles: the files under `podcast-downloads/` are about to go, and rows
 * pointing at them would hand the player a path that no longer exists. The
 * databases themselves stay — the shows and the hearts are the person's own.
 */
export async function clearDownloadRecords(): Promise<void> {
  const scopes = await FileSystem.readDirectoryAsync(ROOT).catch(() => [] as string[]);
  for (const scope of scopes) {
    try {
      const db = await podcastDb(scope);
      await db.runAsync('DELETE FROM podcast_downloads', []);
    } catch {
      // A database that cannot be opened has no rows anyone can read.
    }
    // Closed right after: touching every profile's database must not leave a
    // handle open for each of them.
    await closePodcastDb(scope);
  }
}

/** How many of a show's episodes are downloaded, and their ids. */
export async function downloadedForChannel(
  scope: string,
  channelId: string,
): Promise<{ ids: string[]; count: number }> {
  const db = await podcastDb(scope);
  const rows = await db.getAllAsync<{ id: string }>(
    'SELECT episode_id AS id FROM podcast_downloads WHERE channel_id = ?',
    [channelId],
  );
  const ids = rows.map((r) => r.id);
  return { ids, count: ids.length };
}
