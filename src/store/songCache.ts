/**
 * The song cache (#180): a copy on the phone of what gets streamed, kept up to
 * a size and evicted least recently played first.
 *
 * The song coming up next is fetched while the current one plays, so when its
 * turn comes it plays from the phone and is never streamed: the cache costs no
 * more data than streaming would. The song playing is fetched after it, which
 * is the one place a song goes over the network twice.
 *
 * Nothing here is a download. It has no catalog entry, no badge and no place in
 * the offline library shelves, and any of it can be dropped to make room. What
 * it does share with downloads is being playable without a connection, which
 * the player and the offline lists ask it about by id.
 */
import { Paths } from 'expo-file-system';
import * as FileSystem from 'expo-file-system/legacy';
import { create } from 'zustand';

import type { Song, SubsonicAuth } from '@/api/backend';
import { hashKey } from '@/lib/localLibrary';
import { bump, netTally } from '@/lib/perfLog';
import { primaryUrl } from '@/lib/serverUrls';
import * as Db from '@/lib/songCacheDb';
import { useAuthStore } from './auth';
import { fileSize, fileUrlFor, header, isErrorBody, useDownloads } from './downloads';
import { useNetworkType } from './networkType';
import { useSettings } from './settings';

const ROOT_DIR = FileSystem.documentDirectory + 'song-cache/';
const GB = 1024 ** 3;
/** The cache stops filling before the phone gets this full. */
const MIN_FREE_BYTES = GB;

export type CacheEntry = Omit<Db.CacheRow, 'id'>;
type Target = { bitRate: number; format: string };

/** Same key as the profile's downloads. */
export function songCacheDir(auth: SubsonicAuth): string {
  return `${ROOT_DIR}${hashKey(`${primaryUrl(auth)}|${auth.username}`)}/`;
}

function activeDir(): string | null {
  const auth = useAuthStore.getState().auth;
  return auth ? songCacheDir(auth) : null;
}

function freeBytes(): number {
  try {
    return Paths.availableDiskSpace;
  } catch {
    return Infinity;
  }
}

interface SongCacheState {
  /** Song id (server) → its cached file. */
  entries: Record<string, CacheEntry>;
  hydrate: () => Promise<void>;
  /**
   * The songs worth having now, most wanted first. Replaces whatever was
   * waiting: only the current window of the queue matters. `targetFor` is the
   * quality each would be streamed at.
   */
  want: (songs: Song[], targetFor: (song: Song) => Target) => void;
  /** Marks a cached song as just played. */
  touch: (id: string) => void;
  /** Evicts down to the size limit. */
  trim: () => Promise<void>;
  remove: (ids: string[]) => Promise<void>;
  clear: () => Promise<void>;
  /** Everything cached, with the songs, last played first. */
  list: () => Promise<Db.CachedSong[]>;
  /** Drops an entry whose file is gone, and says whether it did. */
  forgetIfMissing: (id: string) => Promise<boolean>;
}

/** Bytes the cache holds. */
export function cacheBytes(entries: Record<string, CacheEntry>): number {
  let total = 0;
  for (const id in entries) total += entries[id].bytes;
  return total;
}

let hydrateRun = 0;
let wanted: { song: Song; target: Target }[] = [];
/** The window of the queue, which eviction leaves alone. */
let keep = new Set<string>();
let running = false;
/** Bumped by `clear`, so a fetch that outlived it doesn't write into the void. */
let generation = 0;

function cacheable(song: Song): boolean {
  return (
    !song.url &&
    !song.localUri &&
    !useDownloads.getState().files[song.id] &&
    !useSongCache.getState().entries[song.id]
  );
}

/** The song as written down: without the marks a queue or a list puts on it. */
function plain(song: Song): Song {
  const {
    localUri: _localUri,
    unavailable: _unavailable,
    queued: _queued,
    fromMix: _fromMix,
    ...rest
  } = song;
  return rest;
}

async function fetchOne(song: Song, target: Target): Promise<void> {
  const { auth, offline } = useAuthStore.getState();
  if (!auth || offline || !useSettings.getState().songCache || !cacheable(song)) return;
  // Silently, unlike a download: nobody asked for this one.
  if (useSettings.getState().downloadWifiOnly && useNetworkType.getState().cellular) return;
  if (freeBytes() < MIN_FREE_BYTES) return;
  const dir = songCacheDir(auth);
  const gen = generation;
  const { url, ext, bitRate } = fileUrlFor(auth, song, target.bitRate, target.format);
  await FileSystem.makeDirectoryAsync(`${dir}files/`, { intermediates: true }).catch(() => {});
  const file = `${dir}files/${hashKey(song.id)}.${ext}`;
  try {
    const res = await FileSystem.downloadAsync(url, file);
    netTally('stream.view (cache)', Number(header(res.headers, 'content-length')) || 0);
    if (res.status !== 200 || isErrorBody(res.headers)) throw new Error(`HTTP ${res.status}`);
    // Measured rather than taken from the header: a copy cut short would be
    // a song that stops halfway with no stream behind it.
    const bytes = await fileSize(file);
    const expected = Number(header(res.headers, 'content-length')) || 0;
    if (bytes <= 0 || bytes < expected) throw new Error('short');
    // The profile can have changed while it came down, and a download of it
    // can have finished in the meantime.
    if (activeDir() !== dir || gen !== generation || useDownloads.getState().files[song.id]) {
      throw new Error('stale');
    }
    const now = Date.now();
    await Db.insert(dir, {
      id: song.id,
      uri: file,
      bytes,
      bitRate,
      playedAt: now,
      cachedAt: now,
      song: plain(song),
    });
    useSongCache.setState((st) => ({
      entries: { ...st.entries, [song.id]: { uri: file, bytes, bitRate, playedAt: now } },
    }));
    bump('cache · stored a song');
    await useSongCache.getState().trim();
  } catch {
    await FileSystem.deleteAsync(file, { idempotent: true }).catch(() => {});
    bump('cache · failed to store a song');
  }
}

async function run(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (wanted.length > 0) {
      const next = wanted.shift()!;
      await fetchOne(next.song, next.target);
    }
  } finally {
    running = false;
  }
}

export const useSongCache = create<SongCacheState>((set, get) => ({
  entries: {},

  hydrate: async () => {
    const run = ++hydrateRun;
    wanted = [];
    const dir = activeDir();
    let entries: Record<string, CacheEntry> = {};
    if (dir && (await FileSystem.getInfoAsync(dir).catch(() => null))?.exists) {
      try {
        for (const { id, ...rest } of await Db.allRows(dir)) entries[id] = rest;
      } catch {
        entries = {};
      }
    }
    if (run !== hydrateRun) return;
    set({ entries });
  },

  want: (songs, targetFor) => {
    keep = new Set(songs.map((s) => s.id));
    wanted = songs.filter(cacheable).map((song) => ({ song, target: targetFor(song) }));
    void run();
  },

  touch: (id) => {
    const entry = get().entries[id];
    const dir = activeDir();
    if (!entry || !dir) return;
    const now = Date.now();
    set((st) => ({ entries: { ...st.entries, [id]: { ...entry, playedAt: now } } }));
    void Db.touch(dir, id, now).catch(() => {});
  },

  trim: async () => {
    const limit = useSettings.getState().songCacheLimitGb * GB;
    const entries = get().entries;
    let total = cacheBytes(entries);
    if (total <= limit) return;
    const drop: string[] = [];
    const oldest = Object.entries(entries)
      .filter(([id]) => !keep.has(id))
      .sort((a, b) => a[1].playedAt - b[1].playedAt);
    for (const [id, entry] of oldest) {
      if (total <= limit) break;
      drop.push(id);
      total -= entry.bytes;
    }
    await get().remove(drop);
  },

  remove: async (ids) => {
    const dir = activeDir();
    const entries = get().entries;
    const gone = ids.filter((id) => entries[id]);
    if (!dir || gone.length === 0) return;
    set((st) => {
      const next = { ...st.entries };
      for (const id of gone) delete next[id];
      return { entries: next };
    });
    await Db.remove(dir, gone).catch(() => {});
    for (const id of gone) {
      await FileSystem.deleteAsync(entries[id].uri, { idempotent: true }).catch(() => {});
    }
  },

  clear: async () => {
    const dir = activeDir();
    wanted = [];
    generation++;
    set({ entries: {} });
    if (!dir) return;
    await Db.closeCacheDb(dir);
    await FileSystem.deleteAsync(dir, { idempotent: true }).catch(() => {});
  },

  list: async () => {
    const dir = activeDir();
    if (!dir || Object.keys(get().entries).length === 0) return [];
    return Db.allSongs(dir).catch(() => []);
  },

  forgetIfMissing: async (id) => {
    const entry = get().entries[id];
    if (!entry) return false;
    try {
      const info = await FileSystem.getInfoAsync(entry.uri);
      if (info.exists && ((info as { size?: number }).size ?? 1) > 0) return false;
    } catch {
      return false;
    }
    await get().remove([id]);
    return true;
  },
}));

/**
 * Empties one profile's cache, whether or not it is the one signed in: the
 * Navidrome id repair rewrites every id, and a cache is cheaper to refill than
 * to remap.
 */
export async function clearSongCacheFor(auth: SubsonicAuth): Promise<void> {
  const dir = songCacheDir(auth);
  if (activeDir() === dir) {
    await useSongCache.getState().clear();
    return;
  }
  await Db.closeCacheDb(dir);
  await FileSystem.deleteAsync(dir, { idempotent: true }).catch(() => {});
}

/** The file of a cached song, if there is one. */
export function cachedUri(id: string): string | undefined {
  return useSongCache.getState().entries[id]?.uri;
}

// A song that gets downloaded no longer needs its cached copy.
useDownloads.subscribe((s, prev) => {
  if (s.files === prev.files) return;
  const entries = useSongCache.getState().entries;
  const dups: string[] = [];
  for (const id in entries) if (s.files[id]) dups.push(id);
  if (dups.length > 0) void useSongCache.getState().remove(dups);
});
