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

const DB_NAME = 'mirror.db';

let handle: Promise<SQLite.SQLiteDatabase> | null = null;
let handleFor = '';

/**
 * Opens the profile's mirror, migrating its JSON the first time.
 *
 * `dir` is the folder that holds it and `file` the old JSON, both decided by
 * the caller, which is the one that knows how a profile maps to a file.
 */
export function mirrorDb(dir: string, file: string): Promise<SQLite.SQLiteDatabase> {
  if (handle && handleFor === file) return handle;
  handleFor = file;
  handle = (async () => {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
    // SQLite joins directory and name as plain text: the `file://` that the
    // file system module speaks means nothing to it.
    const db = await SQLite.openDatabaseAsync(DB_NAME, {}, dir.replace(/^file:\/\//, ''));
    await db.execAsync(SCHEMA);
    await migrateFromJson(db, file);
    return db;
  })();
  return handle;
}

export async function closeMirror(): Promise<void> {
  const open = handle;
  handle = null;
  handleFor = '';
  await open?.then((db) => db.closeAsync()).catch(() => {});
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
    await db.withTransactionAsync(async () => {
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
    });
  });

  await FileSystem.moveAsync({ from: file, to: `${file}.bak` }).catch(() => {});
}

// ── Writing ─────────────────────────────────────────────────────────────────

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
  file: string,
  kind: Kind,
  id: string,
  value: unknown,
  songs?: Song[],
): Promise<void> {
  const db = await mirrorDb(dir, file);
  await db.withTransactionAsync(() => putEntry(db, kind, id, value, songs));
}

export async function dropEntry(
  dir: string,
  file: string,
  kind: Kind,
  id: string,
): Promise<void> {
  const db = await mirrorDb(dir, file);
  await db.runAsync('DELETE FROM entries WHERE kind = ? AND id = ?', [kind, id]);
}

// ── Reading ─────────────────────────────────────────────────────────────────

async function getEntry<T>(
  dir: string,
  file: string,
  kind: Kind,
  id: string,
): Promise<T | undefined> {
  const db = await mirrorDb(dir, file);
  const row = await db.getFirstAsync<{ data: string }>(
    'SELECT data FROM entries WHERE kind = ? AND id = ?',
    [kind, id],
  );
  return row ? (JSON.parse(row.data) as T) : undefined;
}

export function getStarred(dir: string, file: string): Promise<Starred | undefined> {
  return getEntry<Starred>(dir, file, 'starred', '');
}

export function getPlaylists(dir: string, file: string): Promise<Playlist[] | undefined> {
  return getEntry<Playlist[]>(dir, file, 'playlists', '');
}

export function getPlaylistDetail(
  dir: string,
  file: string,
  id: string,
): Promise<PlaylistDetail | undefined> {
  return getEntry<PlaylistDetail>(dir, file, 'playlist', id);
}

export function getAlbumDetail(
  dir: string,
  file: string,
  id: string,
): Promise<AlbumDetail | undefined> {
  return getEntry<AlbumDetail>(dir, file, 'album', id);
}

export function getArtistDetail(
  dir: string,
  file: string,
  id: string,
): Promise<ArtistDetail | undefined> {
  return getEntry<ArtistDetail>(dir, file, 'artist', id);
}

/** Songs by id, from whatever tracklist they arrived in. In chunks, because
 *  SQLite counts placeholders and a playlist can carry thousands of ids. */
export async function getSongs(
  dir: string,
  file: string,
  ids: string[],
): Promise<Map<string, Song>> {
  const out = new Map<string, Song>();
  if (ids.length === 0) return out;
  const db = await mirrorDb(dir, file);
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
export async function getSong(dir: string, file: string, id: string): Promise<Song | undefined> {
  const db = await mirrorDb(dir, file);
  const row = await db.getFirstAsync<{ data: string }>('SELECT data FROM songs WHERE id = ?', [id]);
  return row ? (JSON.parse(row.data) as Song) : undefined;
}

/** Which of these playlists are already stored, and with which `changed`, so
 *  the prefetch can ask only for what moved. */
export async function playlistVersions(
  dir: string,
  file: string,
): Promise<Record<string, string | undefined>> {
  const db = await mirrorDb(dir, file);
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
export async function stats(dir: string, file: string): Promise<MirrorStats> {
  const db = await mirrorDb(dir, file);
  const counts = await db.getAllAsync<{ kind: string; n: number }>(
    'SELECT kind, COUNT(*) AS n FROM entries GROUP BY kind',
  );
  const by = (k: string) => counts.find((c) => c.kind === k)?.n ?? 0;
  const starred = await getStarred(dir, file);
  let bytes = 0;
  try {
    const info = await FileSystem.getInfoAsync(`${dir}${DB_NAME}`);
    if (info.exists) bytes = info.size ?? 0;
  } catch {
    // reported as zero
  }
  return {
    bytes,
    albums: by('album'),
    artists: by('artist'),
    playlists: by('playlist'),
    starredSongs: starred?.songs?.length ?? 0,
  };
}
