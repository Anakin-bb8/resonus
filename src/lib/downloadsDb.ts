/**
 * The download catalog, in SQLite.
 *
 * It used to be one JSON file per profile holding every downloaded song and
 * album. Any change rewrote the whole thing, and reading it meant parsing all
 * of it into memory before the app could answer the simplest question. On a
 * library of twelve thousand songs that was measured at sixteen seconds to
 * read and thirty seven to write, on the thread that draws the screen (#50).
 *
 * The audio files are not touched by any of this. What changes is the index
 * of them: where each song lives, what it weighs and which album it belongs
 * to. One database per profile, next to that profile's files, so removing a
 * profile still means removing its directory.
 *
 * On the shape of the tables: everything that is filtered, sorted or added up
 * is a real column, and the rest of the song travels along as JSON in `data`.
 * Putting the whole catalog in one JSON column would be the old problem with
 * extra steps; putting the twenty five optional fields of a Subsonic song in
 * twenty five columns would be a migration every time the API grows one.
 */
import * as FileSystem from 'expo-file-system/legacy';
import * as SQLite from 'expo-sqlite';

import type { Album, Song } from '@/api/subsonic';
import { timed } from './perfLog';

/** Downloaded album: the server's, plus its local cover and download date. */
export type DlAlbum = Album & { coverUri?: string; addedAt?: number; dlBytes?: number };

const SCHEMA = `
PRAGMA journal_mode = WAL;
-- The write-ahead log is only truncated back down when a checkpoint is told
-- what size to leave behind; without this it stays at its high water mark for
-- as long as the connection lives, which here is the whole session. Measured
-- at 4 MB of log for 356 KB of database after an afternoon of downloading.
PRAGMA journal_size_limit = 524288;
CREATE TABLE IF NOT EXISTS songs (
  id TEXT PRIMARY KEY NOT NULL,
  album_id TEXT,
  title TEXT,
  artist TEXT,
  disc INTEGER,
  track INTEGER,
  added_at INTEGER,
  dl_bytes INTEGER,
  local_uri TEXT,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS songs_album ON songs(album_id);
CREATE TABLE IF NOT EXISTS albums (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT,
  artist TEXT,
  artist_id TEXT,
  added_at INTEGER,
  dl_bytes INTEGER,
  cover_uri TEXT,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS albums_artist ON albums(artist_id);
`;

/** One handle per profile directory, opened once. */
const open = new Map<string, Promise<SQLite.SQLiteDatabase>>();

/** The directory already identifies the profile, so the name doesn't have to. */
const DB_NAME = 'catalog.db';

async function openDb(dir: string): Promise<SQLite.SQLiteDatabase> {
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
  // The file system module speaks URIs and SQLite speaks paths: it joins the
  // directory and the name as plain text and hands the result to the native
  // open, which knows nothing about `file://`.
  const db = await SQLite.openDatabaseAsync(DB_NAME, {}, dir.replace(/^file:\/\//, ''));
  await db.execAsync(SCHEMA);
  await migrateFromJson(dir, db);
  return db;
}

export function catalogDb(dir: string): Promise<SQLite.SQLiteDatabase> {
  let handle = open.get(dir);
  if (!handle) {
    handle = openDb(dir);
    open.set(dir, handle);
  }
  return handle;
}

/** Closes and forgets every open database (profile change, clear all). */
export async function closeCatalogs(): Promise<void> {
  const handles = [...open.values()];
  open.clear();
  for (const h of handles) {
    await h.then((db) => db.closeAsync()).catch(() => {});
  }
}

// ── Coming from the JSON ────────────────────────────────────────────────────

function jsonFile(dir: string): string {
  return `${dir}catalog.json`;
}

/**
 * Moves an existing `catalog.json` into the database, once.
 *
 * The old file is kept, renamed, and only after the row count matches what it
 * held. It is the record of where someone's downloaded music lives: if
 * anything here is wrong, the answer is to still have it, not to have deleted
 * it. A later version can remove it.
 */
async function migrateFromJson(dir: string, db: SQLite.SQLiteDatabase): Promise<void> {
  const file = jsonFile(dir);
  const info = await FileSystem.getInfoAsync(file).catch(() => null);
  if (!info?.exists) return;
  // Anything already here means a previous run did this, or the app has been
  // writing to the database since. The file is the stale one.
  const existing = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM songs');
  if ((existing?.n ?? 0) > 0) return;

  let parsed: { songs?: Song[]; albums?: DlAlbum[] } = {};
  try {
    const raw = await timed('catalog migrate read', () =>
      FileSystem.readAsStringAsync(file),
    );
    parsed = JSON.parse(raw) as { songs?: Song[]; albums?: DlAlbum[] };
  } catch {
    // Unreadable or not JSON: leave it exactly where it is and start empty.
    return;
  }
  const songs = parsed.songs ?? [];
  const albums = parsed.albums ?? [];
  if (songs.length === 0 && albums.length === 0) return;

  await timed('catalog migrate write', async () => {
    await serialized(() =>
      db.withTransactionAsync(async () => {
        for (const s of songs) await insertSong(db, s);
        for (const a of albums) await insertAlbum(db, a);
      }),
    );
  });

  const after = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM songs');
  if ((after?.n ?? 0) < songs.length) return; // short: keep the file as it is
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


async function insertSong(db: SQLite.SQLiteDatabase, s: Song): Promise<void> {
  await db.runAsync(
    `INSERT OR REPLACE INTO songs
       (id, album_id, title, artist, disc, track, added_at, dl_bytes, local_uri, data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      s.id,
      s.albumId ?? null,
      s.title ?? null,
      s.artist ?? null,
      s.discNumber ?? null,
      s.track ?? null,
      s.addedAt ?? null,
      s.dlBytes ?? null,
      s.localUri ?? null,
      JSON.stringify(s),
    ],
  );
}

async function insertAlbum(db: SQLite.SQLiteDatabase, a: DlAlbum): Promise<void> {
  await db.runAsync(
    `INSERT OR REPLACE INTO albums
       (id, name, artist, artist_id, added_at, dl_bytes, cover_uri, data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      a.id,
      a.name ?? null,
      a.artist ?? null,
      a.artistId ?? null,
      a.addedAt ?? null,
      a.dlBytes ?? null,
      a.coverUri ?? null,
      JSON.stringify(a),
    ],
  );
}

/** Adds songs and albums. What is already there is replaced, not duplicated. */
export async function addToCatalog(
  dir: string,
  changes: { songs?: Song[]; albums?: DlAlbum[] },
): Promise<void> {
  const { songs = [], albums = [] } = changes;
  if (songs.length === 0 && albums.length === 0) return;
  const db = await catalogDb(dir);
  await serialized(() =>
    db.withTransactionAsync(async () => {
      for (const s of songs) await insertSong(db, s);
      for (const a of albums) await insertAlbum(db, a);
    }),
  );
}

/**
 * The most a single statement gets asked about at once.
 *
 * SQLite counts placeholders, not rows, and refuses past a limit that a
 * discography can reach on its own. Deleting an artist's downloads would have
 * failed on exactly the libraries this is meant to help.
 */
const PARAM_CHUNK = 400;

function chunked<T>(items: T[], size = PARAM_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Removes songs, and any album left without them. Returns what was removed,
 *  so the caller can delete the files those rows pointed at. */
export async function removeFromCatalog(
  dir: string,
  ids: string[],
): Promise<{ songs: Song[]; albums: DlAlbum[] }> {
  if (ids.length === 0) return { songs: [], albums: [] };
  const db = await catalogDb(dir);

  const songs: Song[] = [];
  for (const part of chunked(ids)) {
    const marks = part.map(() => '?').join(',');
    const rows = await db.getAllAsync<{ data: string }>(
      `SELECT data FROM songs WHERE id IN (${marks})`,
      part,
    );
    for (const r of rows) songs.push(JSON.parse(r.data) as Song);
  }
  if (songs.length === 0) return { songs: [], albums: [] };

  await serialized(() =>
    db.withTransactionAsync(async () => {
      for (const part of chunked(ids)) {
        const marks = part.map(() => '?').join(',');
        await db.runAsync(`DELETE FROM songs WHERE id IN (${marks})`, part);
      }
    }),
  );

  // Now that they are gone, whichever albums are left with nothing. Asked
  // after the fact rather than predicted, so it needs no parameters at all.
  const empty = await db.getAllAsync<{ data: string }>(
    `SELECT data FROM albums WHERE id NOT IN
       (SELECT DISTINCT album_id FROM songs WHERE album_id IS NOT NULL)`,
  );
  if (empty.length > 0) {
    await serialized(() =>
      db.runAsync(
      `DELETE FROM albums WHERE id NOT IN
         (SELECT DISTINCT album_id FROM songs WHERE album_id IS NOT NULL)`,
      ),
    );
  }
  return { songs, albums: empty.map((r) => JSON.parse(r.data) as DlAlbum) };
}

// ── Reading ─────────────────────────────────────────────────────────────────

/**
 * Song id to file, for the whole profile.
 *
 * Two columns rather than the whole catalog: this is what the interface asks
 * about constantly (is this one downloaded?) and what used to cost parsing
 * every song in the library to answer.
 */
export async function downloadedFiles(
  dir: string,
): Promise<{ files: Record<string, string>; bitRates: Record<string, number> }> {
  const db = await catalogDb(dir);
  const rows = await db.getAllAsync<{ id: string; local_uri: string | null; data: string }>(
    'SELECT id, local_uri, data FROM songs WHERE local_uri IS NOT NULL',
  );
  const files: Record<string, string> = {};
  const bitRates: Record<string, number> = {};
  for (const r of rows) {
    if (!r.local_uri) continue;
    files[r.id] = r.local_uri;
    // Only the transcoded ones carry it, so it is read from the row's own
    // JSON rather than given a column of its own.
    const bit = (JSON.parse(r.data) as Song).dlBitRate;
    if (bit != null) bitRates[r.id] = bit;
  }
  return { files, bitRates };
}

export async function songsOfAlbum(dir: string, albumId: string): Promise<Song[]> {
  const db = await catalogDb(dir);
  const rows = await db.getAllAsync<{ data: string }>(
    `SELECT data FROM songs WHERE album_id = ?
     ORDER BY disc IS NULL, disc, track IS NULL, track, title`,
    [albumId],
  );
  return rows.map((r) => JSON.parse(r.data) as Song);
}

/**
 * Has this album got anything downloaded? Asked without reading any of it.
 *
 * The album screen asks this every time it opens, and it used to be answered by
 * building the whole catalog in memory and searching it, which is the cost this
 * table exists to avoid.
 */
export async function albumHasSongs(dir: string, albumId: string): Promise<boolean> {
  const db = await catalogDb(dir);
  const row = await db.getFirstAsync<{ n: number }>(
    'SELECT 1 AS n FROM songs WHERE album_id = ? LIMIT 1',
    [albumId],
  );
  return !!row;
}

export async function allSongs(dir: string): Promise<Song[]> {
  const db = await catalogDb(dir);
  const rows = await db.getAllAsync<{ data: string }>('SELECT data FROM songs');
  return rows.map((r) => JSON.parse(r.data) as Song);
}

/**
 * Albums, each with how many of its songs are actually downloaded.
 *
 * That count is what the offline library shows, and it is not the one the
 * server sent: an album can be half downloaded. It used to be kept in the
 * stored album and recomputed on every change, which is what made committing a
 * song scan the whole catalog. Here it is asked for when it is needed.
 */
export async function allAlbums(dir: string): Promise<DlAlbum[]> {
  const db = await catalogDb(dir);
  const rows = await db.getAllAsync<{ data: string; n: number }>(
    `SELECT a.data AS data, (SELECT COUNT(*) FROM songs s WHERE s.album_id = a.id) AS n
     FROM albums a`,
  );
  return rows.map((r) => ({ ...(JSON.parse(r.data) as DlAlbum), songCount: r.n }));
}

/** How many songs there are, without reading any of them. */
export async function songCount(dir: string): Promise<number> {
  const db = await catalogDb(dir);
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM songs');
  return row?.n ?? 0;
}

/**
 * What the downloads take on disk, added up by the database.
 *
 * Sizes are written down when each file is downloaded. Anything from before
 * that has none, and those are reported apart so the caller can measure them
 * once and store them, rather than measuring everything every time.
 */
export async function usageBytes(
  dir: string,
): Promise<{ known: number; missing: { id: string; uri: string }[] }> {
  const db = await catalogDb(dir);
  const songs = await db.getFirstAsync<{ total: number | null }>(
    'SELECT SUM(dl_bytes) AS total FROM songs',
  );
  const albums = await db.getFirstAsync<{ total: number | null }>(
    'SELECT SUM(dl_bytes) AS total FROM albums',
  );
  const missing = await db.getAllAsync<{ id: string; local_uri: string }>(
    'SELECT id, local_uri FROM songs WHERE local_uri IS NOT NULL AND dl_bytes IS NULL',
  );
  return {
    known: (songs?.total ?? 0) + (albums?.total ?? 0),
    missing: missing.map((r) => ({ id: r.id, uri: r.local_uri })),
  };
}

/** Writes down sizes measured after the fact, so it happens once per file. */
export async function setSongBytes(
  dir: string,
  sizes: { id: string; bytes: number }[],
): Promise<void> {
  if (sizes.length === 0) return;
  const db = await catalogDb(dir);
  await serialized(() =>
    db.withTransactionAsync(async () => {
      for (const s of sizes) {
        await db.runAsync('UPDATE songs SET dl_bytes = ? WHERE id = ?', [s.bytes, s.id]);
      }
    }),
  );
}
