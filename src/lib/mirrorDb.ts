/**
 * The offline copy of the library, in SQLite.
 *
 * It was one JSON file per profile with everything in it: favourites, the
 * playlist list, every playlist's tracklist, every album and every artist that
 * had been looked at. Saving any one of those rewrote all of it. On a real
 * install that was 34 MB, thirty seven seconds to write and freezes of fifteen
 * (#50), and the answer so far has been to keep less in it: playlists over five
 * hundred songs dropped, albums already downloaded dropped. Those limits exist
 * because of the format, not because anyone wanted them.
 *
 * The shape here is deliberately not a table per kind of thing. What the app
 * asks for is always "this playlist", "this album", "the favourites", so the
 * store is keyed by exactly that, and the entry travels as JSON. Saving an
 * album writes an album. The one place that needs to look inside is resolving
 * a song by id, and that gets its own table, filled as each tracklist arrives.
 */
import * as FileSystem from 'expo-file-system/legacy';
import * as SQLite from 'expo-sqlite';

import type { Album, Artist, Playlist, Song, Starred } from '@/api/subsonic';
import { timed } from './perfLog';

export type PlaylistDetail = { playlist: Playlist; songs: Song[] };
export type AlbumDetail = { album: Album; songs: Song[] };
export type ArtistDetail = { artist: Artist; albums: Album[] };

/** Kinds of entry. The singletons use an empty id. */
type Kind = 'starred' | 'playlists' | 'playlist' | 'album' | 'artist';

const SCHEMA = `
PRAGMA journal_mode = WAL;
-- See downloadsDb: without a size limit the log keeps whatever it grew to,
-- and this one grew larger than the database it belongs to.
PRAGMA journal_size_limit = 524288;
CREATE TABLE IF NOT EXISTS entries (
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (kind, id)
);
CREATE TABLE IF NOT EXISTS songs (
  id TEXT PRIMARY KEY NOT NULL,
  data TEXT NOT NULL
);
`;

/**
 * One database per profile, named after it.
 *
 * The JSON was one file per profile and this has to be too: they all live in
 * the same folder, so a single `mirror.db` would have been every account's
 * library in one place, and whichever migrated first would have been the one
 * everybody saw.
 */
function dbName(profile: string): string {
  return `mirror-${profile}.db`;
}

/** The JSON this profile is coming from, if it hasn't been migrated yet. */
function jsonFile(dir: string, profile: string): string {
  return `${dir}${profile}.json`;
}

/**
 * One handle per profile, kept open.
 *
 * A single handle that closed on switching profiles looked tidier and was a
 * race: reads are in flight while the switch happens, so the close could land
 * on the database that had just been opened, and every read after it failed
 * quietly and left the app looking like it had no offline library at all.
 * Handles are cheap; keeping them costs nothing and there is nothing to time.
 */
const open = new Map<string, Promise<SQLite.SQLiteDatabase>>();

/**
 * Opens a profile's mirror, migrating its JSON the first time.
 *
 * `dir` is the folder they all share and `profile` the name that tells them
 * apart, which is what the caller knows.
 */
export function mirrorDb(dir: string, profile: string): Promise<SQLite.SQLiteDatabase> {
  const existing = open.get(profile);
  if (existing) return existing;
  const handle = (async () => {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
    // SQLite joins directory and name as plain text: the `file://` that the
    // file system module speaks means nothing to it.
    const db = await SQLite.openDatabaseAsync(
      dbName(profile),
      {},
      dir.replace(/^file:\/\//, ''),
    );
    await db.execAsync(SCHEMA);
    await migrateFromJson(db, jsonFile(dir, profile));
    return db;
  })();
  open.set(profile, handle);
  return handle;
}

/** Closes them all. For clearing everything out, not for switching profiles. */
export async function closeMirror(): Promise<void> {
  const handles = [...open.values()];
  open.clear();
  for (const h of handles) {
    await h.then((db) => db.closeAsync()).catch(() => {});
  }
}

// ── Coming from the JSON ────────────────────────────────────────────────────

interface OldMirror {
  starred?: Starred;
  playlists?: Playlist[];
  playlistTracks?: Record<string, PlaylistDetail>;
  albums?: Record<string, AlbumDetail>;
  artists?: Record<string, ArtistDetail>;
}

/**
 * Moves the old file in, once, and renames it rather than deleting it.
 *
 * Everything it held goes in, including what the size limits had been keeping
 * out: there is no longer a reason to leave a long playlist behind.
 */
async function migrateFromJson(db: SQLite.SQLiteDatabase, file: string): Promise<void> {
  const info = await FileSystem.getInfoAsync(file).catch(() => null);
  if (!info?.exists) return;
  const already = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM entries');
  if ((already?.n ?? 0) > 0) return;

  let old: OldMirror;
  try {
    const raw = await timed('mirror migrate read', () => FileSystem.readAsStringAsync(file));
    old = JSON.parse(raw) as OldMirror;
  } catch {
    return; // unreadable: leave it alone and start empty
  }

  await timed('mirror migrate write', async () => {
    await serialized(() =>
      db.withTransactionAsync(async () => {
        if (old.starred) await putEntry(db, 'starred', '', old.starred, old.starred.songs);
        if (old.playlists) await putEntry(db, 'playlists', '', old.playlists);
        for (const [id, d] of Object.entries(old.playlistTracks ?? {})) {
          await putEntry(db, 'playlist', id, d, d.songs);
        }
        for (const [id, d] of Object.entries(old.albums ?? {})) {
          await putEntry(db, 'album', id, d, d.songs);
        }
        for (const [id, d] of Object.entries(old.artists ?? {})) {
          await putEntry(db, 'artist', id, d);
        }
      }),
    );
  });

  await FileSystem.moveAsync({ from: file, to: `${file}.bak` }).catch(() => {});
}

// ── Writing ─────────────────────────────────────────────────────────────────

/**
 * Writes go one at a time.
 *
 * Two transactions at once on the same connection is an error, not a wait, and
 * downloads commit from several workers in parallel: "cannot start a
 * transaction within a transaction" is what that looks like. The JSON had a
 * lock for the same reason; this is that lock, kept where the writes are.
 */
let writeQueue: Promise<unknown> = Promise.resolve();

function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(fn, fn);
  writeQueue = run.catch(() => {});
  return run;
}


async function putEntry(
  db: SQLite.SQLiteDatabase,
  kind: Kind,
  id: string,
  value: unknown,
  songs?: Song[],
): Promise<void> {
  await db.runAsync('INSERT OR REPLACE INTO entries (kind, id, data) VALUES (?, ?, ?)', [
    kind,
    id,
    JSON.stringify(value),
  ]);
  // Every song that goes past leaves its metadata behind, which is what makes
  // resolving one by id a lookup instead of a walk through every tracklist.
  for (const s of songs ?? []) {
    await db.runAsync('INSERT OR REPLACE INTO songs (id, data) VALUES (?, ?)', [
      s.id,
      JSON.stringify(s),
    ]);
  }
}

export async function saveEntry(
  dir: string,
  profile: string,
  kind: Kind,
  id: string,
  value: unknown,
  songs?: Song[],
): Promise<void> {
  const db = await mirrorDb(dir, profile);
  await serialized(() => db.withTransactionAsync(() => putEntry(db, kind, id, value, songs)));
}

export async function dropEntry(
  dir: string,
  profile: string,
  kind: Kind,
  id: string,
): Promise<void> {
  const db = await mirrorDb(dir, profile);
  await serialized(() =>
    db.runAsync('DELETE FROM entries WHERE kind = ? AND id = ?', [kind, id]),
  );
}

// ── Reading ─────────────────────────────────────────────────────────────────

async function getEntry<T>(
  dir: string,
  profile: string,
  kind: Kind,
  id: string,
): Promise<T | undefined> {
  const db = await mirrorDb(dir, profile);
  const row = await db.getFirstAsync<{ data: string }>(
    'SELECT data FROM entries WHERE kind = ? AND id = ?',
    [kind, id],
  );
  return row ? (JSON.parse(row.data) as T) : undefined;
}

export function getStarred(dir: string, profile: string): Promise<Starred | undefined> {
  return getEntry<Starred>(dir, profile, 'starred', '');
}

export function getPlaylists(dir: string, profile: string): Promise<Playlist[] | undefined> {
  return getEntry<Playlist[]>(dir, profile, 'playlists', '');
}

export function getPlaylistDetail(
  dir: string,
  profile: string,
  id: string,
): Promise<PlaylistDetail | undefined> {
  return getEntry<PlaylistDetail>(dir, profile, 'playlist', id);
}

export function getAlbumDetail(
  dir: string,
  profile: string,
  id: string,
): Promise<AlbumDetail | undefined> {
  return getEntry<AlbumDetail>(dir, profile, 'album', id);
}

export function getArtistDetail(
  dir: string,
  profile: string,
  id: string,
): Promise<ArtistDetail | undefined> {
  return getEntry<ArtistDetail>(dir, profile, 'artist', id);
}

/** Songs by id, from whatever tracklist they arrived in. In chunks, because
 *  SQLite counts placeholders and a playlist can carry thousands of ids. */
export async function getSongs(
  dir: string,
  profile: string,
  ids: string[],
): Promise<Map<string, Song>> {
  const out = new Map<string, Song>();
  if (ids.length === 0) return out;
  const db = await mirrorDb(dir, profile);
  for (let i = 0; i < ids.length; i += 400) {
    const part = ids.slice(i, i + 400);
    const marks = part.map(() => '?').join(',');
    const rows = await db.getAllAsync<{ id: string; data: string }>(
      `SELECT id, data FROM songs WHERE id IN (${marks})`,
      part,
    );
    for (const r of rows) out.set(r.id, JSON.parse(r.data) as Song);
  }
  return out;
}

/** A song by id, from whatever tracklist it arrived in. */
export async function getSong(dir: string, profile: string, id: string): Promise<Song | undefined> {
  const db = await mirrorDb(dir, profile);
  const row = await db.getFirstAsync<{ data: string }>('SELECT data FROM songs WHERE id = ?', [id]);
  return row ? (JSON.parse(row.data) as Song) : undefined;
}

/** Which albums are already stored, to know which ones are missing. */
export async function albumIds(dir: string, profile: string): Promise<Set<string>> {
  const db = await mirrorDb(dir, profile);
  const rows = await db.getAllAsync<{ id: string }>(
    "SELECT id FROM entries WHERE kind = 'album'",
  );
  return new Set(rows.map((r) => r.id));
}

/** Which of these playlists are already stored, and with which `changed`, so
 *  the prefetch can ask only for what moved. */
export async function playlistVersions(
  dir: string,
  profile: string,
): Promise<Record<string, string | undefined>> {
  const db = await mirrorDb(dir, profile);
  const rows = await db.getAllAsync<{ id: string; data: string }>(
    "SELECT id, data FROM entries WHERE kind = 'playlist'",
  );
  const out: Record<string, string | undefined> = {};
  for (const r of rows) out[r.id] = (JSON.parse(r.data) as PlaylistDetail).playlist.changed;
  return out;
}

export interface MirrorStats {
  bytes: number;
  albums: number;
  artists: number;
  playlists: number;
  starredSongs: number;
}

/** What it holds, for Settings › Downloads. */
export async function stats(dir: string, profile: string): Promise<MirrorStats> {
  const db = await mirrorDb(dir, profile);
  const counts = await db.getAllAsync<{ kind: string; n: number }>(
    'SELECT kind, COUNT(*) AS n FROM entries GROUP BY kind',
  );
  const by = (k: string) => counts.find((c) => c.kind === k)?.n ?? 0;
  const starred = await getStarred(dir, profile);
  let bytes = 0;
  // The database is three files on disk, and the log is not the small one: it
  // was measured larger than the database itself. Reporting only the database
  // told the user less than half of what the copy was taking.
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      const info = await FileSystem.getInfoAsync(`${dir}${dbName(profile)}${suffix}`);
      if (info.exists) bytes += info.size ?? 0;
    } catch {
      // counted as zero
    }
  }
  return {
    bytes,
    albums: by('album'),
    artists: by('artist'),
    playlists: by('playlist'),
    starredSongs: starred?.songs?.length ?? 0,
  };
}
