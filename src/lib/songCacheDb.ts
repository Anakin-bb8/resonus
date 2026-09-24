/**
 * The index of the song cache (#180), in SQLite, one database per profile next
 * to that profile's cached files.
 *
 * Kept apart from the download catalog on purpose: what is in here can be
 * thrown away at any moment to make room, and the catalog holds what somebody
 * chose to keep.
 */
import * as FileSystem from 'expo-file-system/legacy';
import * as SQLite from 'expo-sqlite';

import type { Song } from '@/api/subsonic';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA journal_size_limit = 524288;
CREATE TABLE IF NOT EXISTS songs (
  id TEXT PRIMARY KEY NOT NULL,
  local_uri TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  bit_rate INTEGER,
  cached_at INTEGER NOT NULL,
  played_at INTEGER NOT NULL,
  data TEXT NOT NULL
);
`;

/** What playback needs to know about a cached song, without the song. */
export interface CacheRow {
  id: string;
  uri: string;
  bytes: number;
  /** Transcode bitrate it was fetched at; absent for the original file. */
  bitRate?: number;
  playedAt: number;
}

/** The same, with the song and when it came in, for the screen that lists them. */
export interface CachedSong extends CacheRow {
  song: Song;
  cachedAt: number;
}

const open = new Map<string, Promise<SQLite.SQLiteDatabase>>();

async function openDb(dir: string): Promise<SQLite.SQLiteDatabase> {
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
  const db = await SQLite.openDatabaseAsync('cache.db', {}, dir.replace(/^file:\/\//, ''));
  await db.execAsync(SCHEMA);
  return db;
}

function cacheDb(dir: string): Promise<SQLite.SQLiteDatabase> {
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

/** Closes one profile's index, for when its directory is about to go. */
export async function closeCacheDb(dir: string): Promise<void> {
  const handle = open.get(dir);
  if (!handle) return;
  open.delete(dir);
  await handle.then((db) => db.closeAsync()).catch(() => {});
}

interface Raw {
  id: string;
  local_uri: string;
  bytes: number;
  bit_rate: number | null;
  played_at: number;
}

function toRow(r: Raw): CacheRow {
  return {
    id: r.id,
    uri: r.local_uri,
    bytes: r.bytes,
    bitRate: r.bit_rate ?? undefined,
    playedAt: r.played_at,
  };
}

/** Every entry, without the songs: what hydrating needs. */
export async function allRows(dir: string): Promise<CacheRow[]> {
  const db = await cacheDb(dir);
  const rows = await db.getAllAsync<Raw>(
    'SELECT id, local_uri, bytes, bit_rate, played_at FROM songs',
  );
  return rows.map(toRow);
}

/** Every entry with its song, last played first. */
export async function allSongs(dir: string): Promise<CachedSong[]> {
  const db = await cacheDb(dir);
  const rows = await db.getAllAsync<Raw & { cached_at: number; data: string }>(
    'SELECT * FROM songs ORDER BY played_at DESC',
  );
  const out: CachedSong[] = [];
  for (const r of rows) {
    try {
      out.push({ ...toRow(r), cachedAt: r.cached_at, song: JSON.parse(r.data) as Song });
    } catch {
      // A row that cannot be read is left for eviction to take.
    }
  }
  return out;
}

export async function insert(
  dir: string,
  row: CacheRow & { song: Song; cachedAt: number },
): Promise<void> {
  const db = await cacheDb(dir);
  await db.runAsync(
    `INSERT OR REPLACE INTO songs (id, local_uri, bytes, bit_rate, cached_at, played_at, data)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.uri,
      row.bytes,
      row.bitRate ?? null,
      row.cachedAt,
      row.playedAt,
      JSON.stringify(row.song),
    ],
  );
}

export async function touch(dir: string, id: string, at: number): Promise<void> {
  const db = await cacheDb(dir);
  await db.runAsync('UPDATE songs SET played_at = ? WHERE id = ?', [at, id]);
}

export async function remove(dir: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await cacheDb(dir);
  // SQLite caps the number of parameters per statement.
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    await db.runAsync(
      `DELETE FROM songs WHERE id IN (${chunk.map(() => '?').join(',')})`,
      chunk,
    );
  }
}
