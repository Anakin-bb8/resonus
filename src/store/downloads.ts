/**
 * Offline downloads (server → device).
 *
 * Files go to the app's private storage
 * (`documentDirectory/downloads/<server hash>/`) and alongside them a JSON
 * catalog is saved with metadata already known from the server (title, artist,
 * album, ids, cover) — without re-scanning ID3 tags. The local profile merges
 * this catalog with the scan of the chosen source (`localQueries.ensureCatalog`).
 * Since MediaStore and SAF don't see the private directory, the merge never
 * produces duplicates.
 *
 * Ids are kept as-is from the server (song and album), which enables the ↓ badge
 * on any profile and, in the future, deferred scrobbling or re-download at
 * another quality. The artist id is normalized to the local key (`normKey(name)`)
 * so artists merge with those from scanning.
 */
import { AppState } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Network from 'expo-network';
import { create } from 'zustand';

import {
  coverArtUrl,
  downloadUrl,
  getAlbum,
  getLyrics,
  getLyricsBySongId,
  streamUrl,
  type Album,
  type Artist,
  type Playlist,
  type Song,
  type SongLyrics,
  type SubsonicAuth,
} from '@/api/backend';
import { tg } from '@/i18n';
import { hashKey, normKey, registerCover } from '@/lib/localLibrary';
import { serializeLrc } from '@/lib/lrc';
import { siblingLrcUri } from '@/lib/localLyrics';
import { queryClient } from '@/lib/query';
import { primaryUrl } from '@/lib/serverUrls';
import { useAuthStore } from './auth';
import { useLibraryMirror } from './libraryMirror';
import { useSettings } from './settings';
import { useToast } from './toast';

const ROOT_DIR = FileSystem.documentDirectory + 'downloads/';
const CONCURRENCY = 3;

/** Downloaded album: the server's + local cover and download date. */
type DlAlbum = Album & { coverUri?: string; addedAt?: number };

/** Persisted catalog per server (songs with `localUri` + albums). */
interface ServerDownloads {
  songs: Song[];
  albums: DlAlbum[];
}

interface GroupProgress {
  done: number;
  total: number;
  /** Fraction (0..1) of the current file, so the progress bar advances between songs. */
  fraction: number;
}

/** Mergeable view by the local profile (artists derived from albums). */
export interface DownloadsCatalog {
  songs: Song[];
  albums: DlAlbum[];
  artists: (Artist & { coverUri?: string })[];
}

function serverDir(auth: SubsonicAuth): string {
  // PRIMARY URL, not the active one: when switching networks the active one
  // changes, and with it this directory, hiding downloads. The primary
  // identifies the profile.
  return `${ROOT_DIR}${hashKey(`${primaryUrl(auth)}|${auth.username}`)}/`;
}

function catalogFile(dir: string): string {
  return `${dir}catalog.json`;
}

async function readServerCatalog(dir: string): Promise<ServerDownloads | null> {
  try {
    const info = await FileSystem.getInfoAsync(catalogFile(dir));
    if (!info.exists) return null;
    const raw = await FileSystem.readAsStringAsync(catalogFile(dir));
    return JSON.parse(raw) as ServerDownloads;
  } catch {
    return null;
  }
}

async function writeServerCatalog(dir: string, catalog: ServerDownloads): Promise<void> {
  try {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
    await FileSystem.writeAsStringAsync(catalogFile(dir), JSON.stringify(catalog));
  } catch {
    // If it can't be persisted, this session's downloads are lost on
    // restart (files become orphaned until a "clear all").
  }
}

/**
 * Serializes changes to a catalog: several groups download at once, and
 * without this two of them could interleave their read-modify-write.
 */
let catalogLock: Promise<unknown> = Promise.resolve();
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const run = catalogLock.then(fn);
  catalogLock = run.catch(() => {});
  return run;
}

// ── Catalogs in memory, written in batches ────────────────────────────────
//
// The whole catalog used to be read, parsed, mutated, serialised and written
// again for EVERY downloaded song. On a library of thousands of tracks that's
// megabytes of JSON per song on the JS thread, so downloading froze the app —
// and a delete, which queues behind all of it, looked like it did nothing at
// all until you restarted (issues #47, #48, #50). Now the catalog is read once
// and the disk sees it on a debounce.

const catalogs = new Map<string, ServerDownloads>();
const dirtyDirs = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/** Quiet time before writing. Short on purpose: what a crash in that window
 *  costs is the record of the last song or two (its file is then orphaned
 *  until a "clear all", same as before this existed). */
const FLUSH_MS = 1500;

async function loadCatalog(dir: string): Promise<ServerDownloads> {
  const hit = catalogs.get(dir);
  if (hit) return hit;
  const read = (await readServerCatalog(dir)) ?? { songs: [], albums: [] };
  // Someone may have loaded it while this was reading: theirs wins, or the
  // changes made in the meantime would be dropped on the floor.
  const now = catalogs.get(dir);
  if (now) return now;
  catalogs.set(dir, read);
  return read;
}

function markDirty(dir: string): void {
  dirtyDirs.add(dir);
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushCatalogs();
  }, FLUSH_MS);
}

/** Writes what's pending. On its own timer, when a download group ends, and
 *  when the app goes to the background. */
export async function flushCatalogs(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  const dirs = [...dirtyDirs];
  dirtyDirs.clear();
  for (const dir of dirs) {
    const catalog = catalogs.get(dir);
    if (catalog) await writeServerCatalog(dir, catalog);
  }
}

// Leaving the app is the moment to make sure nothing pending is lost.
AppState.addEventListener('change', (state) => {
  if (state !== 'active') void flushCatalogs();
});

/** Adds a song/albums to a server's catalog (under the lock). */
function commitToCatalog(
  dir: string,
  changes: { songs?: Song[]; albums?: DlAlbum[] },
): Promise<void> {
  return locked(async () => {
    const catalog = await loadCatalog(dir);
    for (const al of changes.albums ?? []) {
      if (!catalog.albums.some((a) => a.id === al.id)) catalog.albums.push(al);
    }
    for (const s of changes.songs ?? []) {
      if (!catalog.songs.some((x) => x.id === s.id)) catalog.songs.push(s);
    }
    // Albums reflect how many songs are actually downloaded.
    for (const a of catalog.albums) {
      a.songCount = catalog.songs.filter((s) => s.albumId === a.id).length;
    }
    markDirty(dir);
  });
}

/** All server directories with downloads. */
async function serverDirs(): Promise<string[]> {
  try {
    const entries = await FileSystem.readDirectoryAsync(ROOT_DIR);
    return entries.map((e) => `${ROOT_DIR}${e}/`);
  } catch {
    return []; // ROOT_DIR does not exist yet
  }
}

// ── Active account's catalog, cached in memory ───────────────────────────

let cachedCatalog: DownloadsCatalog | null = null;
let cachedForDir: string | null = null;

/** Download directory for the active server account (null if none). */
function activeServerDir(): string | null {
  const auth = useAuthStore.getState().auth;
  return auth ? serverDir(auth) : null;
}

function deriveArtists(albums: DlAlbum[]): (Artist & { coverUri?: string })[] {
  const map = new Map<string, Artist & { coverUri?: string }>();
  for (const al of albums) {
    const name = al.artist || 'Artista desconocido';
    const key = normKey(name);
    const existing = map.get(key);
    if (existing) {
      existing.albumCount = (existing.albumCount ?? 0) + 1;
      if (!existing.coverUri) existing.coverUri = al.coverUri;
    } else {
      map.set(key, { id: key, name, coverArt: key, albumCount: 1, coverUri: al.coverUri });
    }
  }
  return Array.from(map.values());
}

/**
 * Downloads for the active SERVER account. This is the library for the "server
 * account offline" mode (the local profile only shows phone music). Each account
 * sees only its own. Registers covers in the global index.
 */
export async function getDownloadsCatalog(): Promise<DownloadsCatalog> {
  const dir = activeServerDir();
  if (!dir) return { songs: [], albums: [], artists: [] };
  if (!cachedCatalog || cachedForDir !== dir) {
    const cat = await loadCatalog(dir);
    // A copy: this view is handed out to screens, and the catalog underneath
    // keeps being mutated by downloads and deletions.
    cachedCatalog = {
      songs: [...cat.songs],
      albums: [...cat.albums],
      artists: deriveArtists(cat.albums),
    };
    cachedForDir = dir;
  }
  // Always (not just on build): clearLocalCatalog() empties the global cover
  // index and downloaded covers need to be re-registered.
  for (const a of cachedCatalog.albums) registerCover(a.id, a.coverUri);
  for (const a of cachedCatalog.artists) registerCover(a.id, a.coverUri);
  return cachedCatalog;
}

/** Does the active account have downloads? Cheap: uses the cached catalog. */
export async function hasDownloads(): Promise<boolean> {
  return (await getDownloadsCatalog()).songs.length > 0;
}

function invalidate() {
  cachedCatalog = null;
  cachedForDir = null;
  // Offline the whole library IS this catalog, so every list has to be asked
  // again. Online none of it comes from here — the server answers those, and
  // the "downloaded" mark on a row reads this store directly, which is already
  // reactive. Invalidating everything there meant that finishing a download
  // sent the app off to re-fetch its entire visible state from the server, for
  // nothing (#50).
  if (useAuthStore.getState().offline) void queryClient.invalidateQueries();
}

// ── File download ─────────────────────────────────────────────────────────

/** Reads a header case-insensitively (casing varies by platform). */
function header(headers: Record<string, string> | undefined, name: string): string {
  if (!headers) return '';
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  return key ? headers[key] : '';
}

/**
 * Is the response an error disguised as a file?
 *
 * Subsonic signals errors with **HTTP 200 and an error body** (`status:
 * "failed"`), not with an HTTP code, so checking `res.status` is not enough.
 * Tested against Navidrome 0.63.2: requesting `/rest/stream` or `/rest/download`
 * with a nonexistent id returns 200 and 182 bytes of JSON. Without this filter
 * that would be saved as .mp3, the song would be marked as downloaded, and it
 * would never be retried (`pending` skips what's already in `files`); you'd find
 * out when there's no coverage, which is exactly why you downloaded it.
 *
 * Uses a blocklist on purpose, not requiring `audio/*`: `/rest/download`
 * returns the raw file and some servers send it as
 * `application/octet-stream`. Requiring audio/* would leave those unable to
 * download anything — we'd replace a rare bug with a constant one. Here only
 * what cannot possibly be audio is rejected: the API's own JSON/XML, and
 * incidentally the HTML from a proxy or a wifi captive portal.
 */
function isErrorBody(headers: Record<string, string> | undefined): boolean {
  return /^\s*(application\/json|application\/xml|text\/xml|text\/html)/i.test(
    header(headers, 'content-type'),
  );
}

// File extension the server returns when transcoding to each codec.
// '' = default transcoder (MP3 in Navidrome). AAC: Navidrome outputs raw
// ADTS (.aac); other servers may use MP4 container (.m4a), but it sounds
// the same (expo-audio detects by content) and only the label would vary.
const FORMAT_EXT: Record<string, string> = { '': 'mp3', mp3: 'mp3', opus: 'opus', aac: 'aac' };

function songFileUrl(
  auth: SubsonicAuth,
  song: Song,
): { url: string; ext: string; bitRate?: number } {
  const { downloadBitRate: bitrate, downloadFormat: format } = useSettings.getState();
  if (bitrate > 0) {
    return {
      url: streamUrl(auth, song.id, bitrate, 0, format),
      ext: FORMAT_EXT[format] ?? 'mp3',
      bitRate: bitrate,
    };
  }
  return { url: downloadUrl(auth, song.id), ext: song.suffix || 'mp3' };
}

/** Song as it enters the local catalog: server id + local file. */
function toLocalSong(song: Song, fileUri: string, dlBitRate?: number): Song {
  return {
    ...song,
    localUri: fileUri,
    // Transcode bitrate at download time (if any): the file on disk doesn't
    // carry it, so the quality label can show it offline.
    dlBitRate,
    // Local artist id (by name) to merge with artists from scanning.
    artistId: normKey(song.artist || 'Artista desconocido'),
    // Server ids don't work offline: we re-peg each artist by name.
    artists: song.artists?.map((a) => ({ id: normKey(a.name), name: a.name })),
    coverArt: song.albumId,
    addedAt: Date.now(),
    // Server favorites don't apply to the local profile (uses local favorites).
    starred: undefined,
  };
}

function toLocalAlbum(album: Album, coverUri?: string): DlAlbum {
  return {
    ...album,
    artistId: normKey(album.artist || 'Artista desconocido'),
    artists: album.artists?.map((a) => ({ id: normKey(a.name), name: a.name })),
    coverArt: album.id,
    coverUri,
    addedAt: Date.now(),
  };
}

/**
 * Saves to the library mirror the COMPLETE tracklist of each album for these
 * songs (best-effort, in the background, while online). Thus, offline, an album
 * from which you only downloaded some songs shows in full with the non-downloaded
 * ones grayed out. Skips those already in the mirror to avoid repeated requests.
 */
async function mirrorAlbumTracklists(auth: SubsonicAuth, songs: Song[]): Promise<void> {
  const mirror = useLibraryMirror.getState();
  const have = mirror.data.albums ?? {};
  const ids = [...new Set(songs.map((s) => s.albumId).filter((id): id is string => !!id))];
  for (const id of ids) {
    if (have[id]) continue;
    try {
      const res = await getAlbum(auth, id);
      mirror.saveAlbum(id, res.album, res.songs);
    } catch {
      // best-effort: if the album can't be requested, it stays unmirrored.
    }
  }
}

/** Synthesized album from a song (playlists with partially downloaded albums). */
function albumFromSong(song: Song): Album {
  return {
    id: song.albumId ?? `dl-${hashKey(song.album || song.id)}`,
    name: song.album || 'Álbum desconocido',
    artist: song.artist,
    year: song.year,
  };
}

/**
 * Caches a newly downloaded song's lyrics as `.lrc` alongside the
 * file, so the local profile finds them without network (lyrics phase 2).
 * Without lyrics (or without the songLyrics extension on the server) nothing happens.
 */
async function cacheLyricsForDownload(auth: SubsonicAuth, song: Song, audioFile: string): Promise<void> {
  try {
    let lyrics: SongLyrics | null = null;
    try {
      lyrics = await getLyricsBySongId(auth, song.id);
    } catch {
      // Server without the songLyrics extension: try the classic endpoint.
    }
    if (!lyrics) {
      const plain = await getLyrics(auth, song.artist ?? '', song.title);
      if (plain) lyrics = { synced: false, lines: plain.split('\n').map((value) => ({ value })) };
    }
    if (!lyrics) return;
    const lrcFile = siblingLrcUri(audioFile);
    if (lrcFile) await FileSystem.writeAsStringAsync(lrcFile, serializeLrc(lyrics));
  } catch {
    // The download is still valid without lyrics.
  }
}

async function downloadCover(auth: SubsonicAuth, dir: string, album: Album): Promise<string | undefined> {
  const url = coverArtUrl(auth, album.coverArt ?? album.id, 500);
  if (!url) return undefined;
  const file = `${dir}covers/${hashKey(album.id)}.jpg`;
  try {
    const existing = await FileSystem.getInfoAsync(file);
    if (existing.exists) return file;
    await FileSystem.makeDirectoryAsync(`${dir}covers/`, { intermediates: true }).catch(() => {});
    const res = await FileSystem.downloadAsync(url, file);
    // Same care as with audio, and we also need to delete: the download writes
    // whatever comes, and with the bad file on disk the shortcut above
    // (`existing.exists`) would consider it a valid cover forever.
    if (res.status !== 200 || isErrorBody(res.headers)) {
      await FileSystem.deleteAsync(file, { idempotent: true }).catch(() => {});
      return undefined;
    }
    return file;
  } catch {
    return undefined;
  }
}

interface DownloadsState {
  /** Song id (server) → uri of the downloaded file. */
  files: Record<string, string>;
  /**
   * Song id → bitrate (kbps) at which it was transcoded on download, if
   * transcoded. Queried by id (not by song object) because offline the player
   * may show the song from the server mirror, not the catalog. Only new
   * transcoded downloads have this.
   */
  dlBitRates: Record<string, number>;
  /** Progress per ongoing group: `album:<id>` / `playlist:<id>` / `artist:<id>`. */
  active: Record<string, GroupProgress>;
  /**
   * `files` has been read from disk. Until then it is empty, which reads the
   * same as "nothing is downloaded" — and whoever decides something by that
   * (see the library mirror) would decide it wrong.
   */
  hydrated: boolean;
  hydrate: () => Promise<void>;
  downloadAlbum: (album: Album, songs: Song[]) => Promise<void>;
  downloadPlaylist: (playlist: Playlist, songs: Song[]) => Promise<void>;
  /**
   * Downloads an artist's discography (group `artist:<id>`). Receives songs
   * and albums already: the artist screen only has the album list, so
   * the caller is the one who already fetched them.
   */
  downloadArtist: (artistId: string, songs: Song[], albums: Album[]) => Promise<void>;
  /** Downloads all favorite songs (group 'favorites'). */
  downloadFavorites: (songs: Song[]) => Promise<void>;
  downloadSong: (song: Song) => Promise<void>;
  /** Downloads a loose batch of songs (multiple selection). */
  downloadSongs: (songs: Song[]) => Promise<void>;
  /** Stops an ongoing group download (already downloaded items are kept). */
  cancelDownload: (groupKey: string) => void;
  /** Deletes files for those songs and removes them from the catalog. */
  deleteSongs: (songIds: string[]) => Promise<void>;
  clearAll: () => Promise<void>;
  usageBytes: () => Promise<number>;
}

/** true only if the active connection is mobile data (for "Wi-Fi only" mode). */
async function onMobileData(): Promise<boolean> {
  try {
    const state = await Network.getNetworkStateAsync();
    return state.type === Network.NetworkStateType.CELLULAR;
  } catch {
    return false; // when in doubt, don't block the download
  }
}

export const useDownloads = create<DownloadsState>((set, get) => {
  // Groups with a stop requested: workers check this and stop picking new
  // songs. Already downloaded items are kept.
  const cancelling = new Set<string>();
  // Ongoing downloads per group, to abort them on stop (instant stop).
  const activeTasks = new Map<
    string,
    Set<ReturnType<typeof FileSystem.createDownloadResumable>>
  >();

  /** Downloads a group of songs and updates catalog + progress. */
  async function downloadGroup(groupKey: string, songs: Song[], albums: Album[]): Promise<void> {
    const auth = useAuthStore.getState().auth;
    if (!auth) return;
    if (get().active[groupKey]) return; // already in progress
    // No duplicates (a playlist may have the same song twice) nor
    // already downloaded, radio songs (url), or songs already local.
    const seen = new Set<string>();
    const pending = songs.filter((s) => {
      if (get().files[s.id] || s.url || s.localUri || seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    });
    if (pending.length === 0) return;

    // "Wi-Fi only" mode: don't start on mobile data.
    if (useSettings.getState().downloadWifiOnly && (await onMobileData())) {
      useToast.getState().show(tg('Connect to Wi-Fi to download'));
      return;
    }

    const dir = serverDir(auth);
    set((st) => ({ active: { ...st.active, [groupKey]: { done: 0, total: pending.length, fraction: 0 } } }));

    try {
      await FileSystem.makeDirectoryAsync(`${dir}files/`, { intermediates: true }).catch(() => {});

      // The cover and album entry are downloaded the first time one of their
      // songs appears, not all at once at the start. This way the download
      // begins immediately (without "scanning" all albums first) and the
      // stop is also responsive during that phase.
      const albumById = new Map(albums.map((a) => [a.id, a]));
      const albumDone = new Set<string>();
      const ensureAlbum = async (song: Song): Promise<void> => {
        const album = song.albumId ? albumById.get(song.albumId) : undefined;
        if (!album || albumDone.has(album.id)) return;
        albumDone.add(album.id); // mark before await: so another worker won't repeat it
        const coverUri = await downloadCover(auth, dir, album);
        await commitToCatalog(dir, { albums: [toLocalAlbum(album, coverUri)] });
      };

      // Ongoing tasks, aborted on stop (instant stop).
      const tasks = new Set<ReturnType<typeof FileSystem.createDownloadResumable>>();
      activeTasks.set(groupKey, tasks);

      let failed = 0;
      let next = 0;
      const workers = Array.from({ length: Math.min(CONCURRENCY, pending.length) }, async () => {
        while (next < pending.length) {
          if (cancelling.has(groupKey)) break; // stop requested by user
          const song = pending[next++];
          await ensureAlbum(song);
          if (cancelling.has(groupKey)) break; // may have stopped during cover download
          const { url, ext, bitRate: dlBitRate } = songFileUrl(auth, song);
          const file = `${dir}files/${hashKey(song.id)}.${ext}`;
          const task = FileSystem.createDownloadResumable(url, file, {}, (p) => {
            if (p.totalBytesExpectedToWrite > 0) {
              const fraction = p.totalBytesWritten / p.totalBytesExpectedToWrite;
              const cur = get().active[groupKey];
              // Updates coarsely to avoid continuous re-renders.
              if (cur && fraction - cur.fraction > 0.05) {
                set((st) => ({
                  active: { ...st.active, [groupKey]: { ...cur, fraction } },
                }));
              }
            }
          });
          tasks.add(task);
          try {
            const res = await task.downloadAsync();
            if (!res || res.status !== 200) throw new Error(`HTTP ${res?.status}`);
            if (isErrorBody(res.headers)) throw new Error('error body, not audio');
            await cacheLyricsForDownload(auth, song, file);
            // Each song is persisted on completion: if the app dies mid-album,
            // already downloaded items survive a restart.
            await commitToCatalog(dir, { songs: [toLocalSong(song, file, dlBitRate)] });
            set((st) => {
              const cur = st.active[groupKey];
              return {
                files: { ...st.files, [song.id]: file },
                dlBitRates:
                  dlBitRate != null
                    ? { ...st.dlBitRates, [song.id]: dlBitRate }
                    : st.dlBitRates,
                active: cur
                  ? { ...st.active, [groupKey]: { ...cur, done: cur.done + 1, fraction: 0 } }
                  : st.active,
              };
            });
          } catch {
            // Aborted on stop or network error: discard the partially-downloaded file.
            // If it was a stop it doesn't count as failure (the toast already says "stopped").
            if (!cancelling.has(groupKey)) failed++;
            await FileSystem.deleteAsync(file, { idempotent: true }).catch(() => {});
          } finally {
            tasks.delete(task);
          }
        }
      });
      await Promise.all(workers);

      invalidate();
      // In the background: mirrors the complete tracklist of touched albums,
      // to see them in full (with grays) offline even if only one song was downloaded.
      if (!cancelling.has(groupKey)) void mirrorAlbumTracklists(auth, pending);
      if (cancelling.has(groupKey)) {
        useToast.getState().show(tg('Download stopped'));
      } else if (failed > 0) {
        useToast.getState().show(tg("{n} songs couldn't be downloaded", { n: failed }));
      } else {
        // Confirmation on finish (the initial "Downloading…" doesn't say when it ends).
        useToast
          .getState()
          .show(
            pending.length === 1
              ? tg('Song downloaded')
              : tg('{n} songs downloaded', { n: pending.length }),
          );
      }
    } finally {
      cancelling.delete(groupKey);
      activeTasks.delete(groupKey);
      // Nothing more is coming for this group: persist without waiting for the
      // timer, so what was downloaded survives a crash right afterwards.
      void flushCatalogs();
      set((st) => {
        const active = { ...st.active };
        delete active[groupKey];
        return { active };
      });
    }
  }

  return {
    files: {},
    dlBitRates: {},
    active: {},
    hydrated: false,

    hydrate: async () => {
      const files: Record<string, string> = {};
      const dlBitRates: Record<string, number> = {};
      for (const dir of await serverDirs()) {
        const cat = await loadCatalog(dir);
        for (const s of cat.songs) {
          if (s.localUri) files[s.id] = s.localUri;
          if (s.dlBitRate) dlBitRates[s.id] = s.dlBitRate;
        }
      }
      set({ files, dlBitRates, hydrated: true });
    },

    downloadAlbum: async (album, songs) => {
      await downloadGroup(`album:${album.id}`, songs, [album]);
    },

    downloadArtist: async (artistId, songs, albums) => {
      await downloadGroup(`artist:${artistId}`, songs, albums);
    },

    downloadSong: async (song) => {
      await downloadGroup(`song:${song.id}`, [song], [albumFromSong(song)]);
    },

    downloadSongs: async (songs) => {
      // Involved albums: those of the songs (partial entry if needed).
      const byId = new Map<string, Album>();
      for (const s of songs) {
        const al = albumFromSong(s);
        if (!byId.has(al.id)) byId.set(al.id, al);
      }
      // Unique key: each batch is an ephemeral group without its own progress UI.
      await downloadGroup(`batch:${Date.now()}`, songs, Array.from(byId.values()));
    },

    downloadPlaylist: async (playlist, songs) => {
      // Involved albums: those of the songs (partial entry if needed).
      const byId = new Map<string, Album>();
      for (const s of songs) {
        const al = albumFromSong(s);
        if (!byId.has(al.id)) byId.set(al.id, al);
      }
      await downloadGroup(`playlist:${playlist.id}`, songs, Array.from(byId.values()));
      // The playlist also exists in the local profile, with its server ids.
      const downloadedIds = songs.map((s) => s.id).filter((id) => get().files[id]);
      if (downloadedIds.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        await require('@/lib/localQueries').upsertLocalPlaylist(
          `dl_${playlist.id}`,
          playlist.name,
          downloadedIds,
          playlist.comment,
        );
      }
    },

    downloadFavorites: async (songs) => {
      // Involved albums: those of the songs (partial entry if needed).
      const byId = new Map<string, Album>();
      for (const s of songs) {
        const al = albumFromSong(s);
        if (!byId.has(al.id)) byId.set(al.id, al);
      }
      await downloadGroup('favorites', songs, Array.from(byId.values()));
    },

    cancelDownload: (groupKey) => {
      if (!get().active[groupKey]) return;
      cancelling.add(groupKey);
      // Aborts what is currently downloading (doesn't wait for it to finish).
      const tasks = activeTasks.get(groupKey);
      if (tasks) for (const t of tasks) void t.cancelAsync().catch(() => {});
    },

    deleteSongs: async (songIds) => {
      const ids = new Set(songIds);
      // The state goes first, before touching the disk: deleting used to show
      // nothing at all until the files were gone, and behind an ongoing
      // download that could be a very long while — long enough to look broken
      // and be retried (#48).
      set((st) => {
        const files = { ...st.files };
        const dlBitRates = { ...st.dlBitRates };
        for (const id of songIds) {
          delete files[id];
          delete dlBitRates[id];
        }
        return { files, dlBitRates };
      });
      invalidate();
      await locked(async () => {
        for (const dir of await serverDirs()) {
          const catalog = await loadCatalog(dir);
          if (!catalog.songs.some((s) => ids.has(s.id))) continue;
          for (const s of catalog.songs) {
            if (ids.has(s.id) && s.localUri) {
              await FileSystem.deleteAsync(s.localUri, { idempotent: true }).catch(() => {});
              // Also the cached lyrics alongside the file, if any.
              const lrc = siblingLrcUri(s.localUri);
              if (lrc) await FileSystem.deleteAsync(lrc, { idempotent: true }).catch(() => {});
            }
          }
          catalog.songs = catalog.songs.filter((s) => !ids.has(s.id));
          // Albums left with no songs: removed (and their covers).
          const emptyAlbums = catalog.albums.filter(
            (a) => !catalog.songs.some((s) => s.albumId === a.id),
          );
          for (const a of emptyAlbums) {
            if (a.coverUri) await FileSystem.deleteAsync(a.coverUri, { idempotent: true }).catch(() => {});
          }
          catalog.albums = catalog.albums.filter((a) => !emptyAlbums.includes(a));
          for (const a of catalog.albums) {
            a.songCount = catalog.songs.filter((s) => s.albumId === a.id).length;
          }
          markDirty(dir);
        }
      });
      // The catalog on disk must not outlive the files it points at.
      await flushCatalogs();
      invalidate();
    },

    clearAll: async () => {
      await locked(async () => {
        catalogs.clear();
        dirtyDirs.clear();
        await FileSystem.deleteAsync(ROOT_DIR, { idempotent: true }).catch(() => {});
      });
      // Local playlists created by downloads no longer resolve songs;
      // they are removed to avoid leaving empty lists.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      await require('@/lib/localQueries').deleteLocalPlaylistsByPrefix('dl_');
      set({ files: {}, dlBitRates: {}, active: {} });
      invalidate();
    },

    usageBytes: async () => {
      let total = 0;
      for (const dir of await serverDirs()) {
        for (const sub of ['files/', 'covers/']) {
          try {
            const entries = await FileSystem.readDirectoryAsync(dir + sub);
            for (const e of entries) {
              const info = await FileSystem.getInfoAsync(dir + sub + e);
              if (info.exists) total += ((info as any).size as number) || 0;
            }
          } catch {
            // nonexistent subfolder
          }
        }
      }
      return total;
    },
  };
});

/** State of a group's download button (album/playlist header). */
export function groupDownloadState(
  st: Pick<DownloadsState, 'files' | 'active'>,
  groupKey: string,
  songIds: string[],
): { status: 'none' | 'active' | 'done'; progress: number } {
  const g = st.active[groupKey];
  if (g) return { status: 'active', progress: (g.done + g.fraction) / Math.max(1, g.total) };
  const relevant = songIds.filter(Boolean);
  if (relevant.length > 0 && relevant.every((id) => st.files[id])) {
    return { status: 'done', progress: 1 };
  }
  return { status: 'none', progress: 0 };
}
