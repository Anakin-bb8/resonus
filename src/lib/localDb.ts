/**
 * The phone's own music, catalogued, in a database.
 *
 * The local profile scans a folder or the whole device and ends up with every
 * song, album and artist it found. That used to be one JSON file per source,
 * written whole after a scan and parsed whole on every start: a library of a
 * few thousand files is several megabytes of string built in one piece and
 * taken apart again, on the thread that is trying to draw the first screen.
 *
 * Same shape as the downloads catalog next door, and for the same reasons: a
 * row per thing, the object itself kept as JSON in a column, and the columns
 * that get searched on pulled out beside it. Rows can be written in batches and
 * read back without a single string holding the library.
 *
 * One database per source, since "the device" and each chosen folder are
 * different libraries and are scanned apart.
 */
import * as SQLite from 'expo-sqlite';

import type { Song } from '@/api/subsonic';
import { timed } from './perfLog';

const SCHEMA = `
PRAGMA journal_mode = WAL;
-- See downloadsDb: without a limit the log keeps whatever it grew to.
PRAGMA journal_size_limit = 524288;
-- The columns are the ones that get sorted, searched or grouped on, pulled out
-- beside the object itself so that answering "the first fifty albums by name"
-- is the database's job and not fifteen thousand objects' walk through JS.
-- Same shape as the downloads catalog, so one set of queries serves both.
CREATE TABLE IF NOT EXISTS songs (
  id TEXT PRIMARY KEY NOT NULL,
  album_id TEXT,
  artist_key TEXT,
  title TEXT,
  artist TEXT,
  disc INTEGER,
  track INTEGER,
  added_at INTEGER,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS songs_album ON songs(album_id);
CREATE INDEX IF NOT EXISTS songs_artist ON songs(artist_key);
CREATE INDEX IF NOT EXISTS songs_title ON songs(title);
CREATE TABLE IF NOT EXISTS albums (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT,
  artist TEXT,
  artist_key TEXT,
  added_at INTEGER,
  year INTEGER,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS albums_name ON albums(name);
CREATE INDEX IF NOT EXISTS albums_artist ON albums(artist_key);
CREATE TABLE IF NOT EXISTS artists (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS artists_name ON artists(name);
`;

/** Rows per statement. Two placeholders each, well under the limit. */
const PER_INSERT = 200;

const open = new Map<string, Promise<SQLite.SQLiteDatabase>>();

/**
 * One handle per source, in the folder the catalogs already lived in, so that
 * "Scan again" deleting that folder still takes everything with it.
 */
function db(dir: string, name: string): Promise<SQLite.SQLiteDatabase> {
  const key = `${dir}|${name}`;
  const existing = open.get(key);
  if (existing) return existing;
  const work = (async () => {
    const handle = await SQLite.openDatabaseAsync(name, {}, dir.replace(/^file:\/\//, ''));
    await handle.execAsync(SCHEMA);
    return handle;
  })();
  open.set(key, work);
  return work;
}

/** Closes them all, for when the directory they live in is about to go. */
export async function closeLocalDbs(): Promise<void> {
  const handles = [...open.values()];
  open.clear();
  for (const h of handles) await h.then((d) => d.closeAsync()).catch(() => {});
}

/** What a catalog holds, as the rest of the app knows it. */
export interface StoredCatalog<A, R> {
  songs: Song[];
  albums: A[];
  artists: R[];
}

async function rows<T>(handle: SQLite.SQLiteDatabase, table: string): Promise<T[]> {
  const found = await handle.getAllAsync<{ data: string }>(`SELECT data FROM ${table}`);
  return found.map((r) => JSON.parse(r.data) as T);
}

/** The whole catalog, or null if this source has never been scanned. */
export async function loadCatalog<A, R>(
  dir: string,
  name: string,
): Promise<StoredCatalog<A, R> | null> {
  const handle = await db(dir, name);
  return timed('local catalog read', async () => {
    const songs = await rows<Song>(handle, 'songs');
    if (songs.length === 0) return null;
    return {
      songs,
      albums: await rows<A>(handle, 'albums'),
      artists: await rows<R>(handle, 'artists'),
    };
  });
}

/** The columns each table carries besides the object itself. */
type Columns = (item: never) => (string | number | null)[];

const COLUMNS: Record<string, { names: string[]; of: Columns }> = {
  songs: {
    names: ['album_id', 'artist_key', 'title', 'artist', 'disc', 'track', 'added_at'],
    of: ((s: Song) => [
      s.albumId ?? null,
      s.artistId ?? null,
      s.title ?? null,
      s.artist ?? null,
      s.discNumber ?? null,
      s.track ?? null,
      s.addedAt ?? null,
    ]) as Columns,
  },
  albums: {
    names: ['name', 'artist', 'artist_key', 'added_at', 'year'],
    of: ((a: { name?: string; artist?: string; artistId?: string; addedAt?: number; year?: number }) => [
      a.name ?? null,
      a.artist ?? null,
      a.artistId ?? null,
      a.addedAt ?? null,
      a.year ?? null,
    ]) as Columns,
  },
  artists: {
    names: ['name'],
    of: ((a: { name?: string }) => [a.name ?? null]) as Columns,
  },
};

async function replace(
  handle: SQLite.SQLiteDatabase,
  table: string,
  items: { id: string }[],
): Promise<void> {
  const spec = COLUMNS[table];
  const cols = ['id', ...spec.names, 'data'];
  const placeholders = `(${cols.map(() => '?').join(', ')})`;
  await handle.runAsync(`DELETE FROM ${table}`);
  for (let i = 0; i < items.length; i += PER_INSERT) {
    const part = items.slice(i, i + PER_INSERT);
    const marks = part.map(() => placeholders).join(',');
    const params: (string | number | null)[] = [];
    for (const it of part) {
      params.push(it.id, ...spec.of(it as never), JSON.stringify(it));
    }
    await handle.runAsync(
      `INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) VALUES ${marks}`,
      params,
    );
  }
}

/**
 * Writes a scan down, replacing whatever was there.
 *
 * In one transaction: a scan that is interrupted half way through leaves the
 * previous catalog rather than half of two.
 */
export async function saveCatalog<A extends { id: string }, R extends { id: string }>(
  dir: string,
  name: string,
  catalog: StoredCatalog<A, R>,
): Promise<void> {
  const handle = await db(dir, name);
  await timed('local catalog write', () =>
    handle.withTransactionAsync(async () => {
      await replace(handle, 'songs', catalog.songs as { id: string }[]);
      await replace(handle, 'albums', catalog.albums);
      await replace(handle, 'artists', catalog.artists);
    }),
  );
}
