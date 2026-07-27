/**
 * Server library mirror for offline mode.
 *
 * While online, viewing favorites, playlists, an album or an artist saves a
 * copy to disk (per profile, like the download catalog). Offline with a server
 * account, the Library screen reads from here and marks each song as available
 * (downloaded) or not.
 *
 * It is NOT a mirror of the ENTIRE library: only favorited items, playlists and
 * whatever has downloads, which is what the Library screen shows. What was
 * never seen online won't be there, and neither will an album that was only
 * looked at (see `worthKeepingAlbum`).
 */
import * as FileSystem from 'expo-file-system/legacy';
import { AppState } from 'react-native';
import { create } from 'zustand';

import type { Album, Artist, Playlist, Song, Starred, SubsonicAuth } from '@/api/subsonic';
import { hashKey } from '@/lib/localLibrary';
import { timed, timedSync } from '@/lib/perfLog';
import { primaryUrl } from '@/lib/serverUrls';
import { useAuthStore } from './auth';

/**
 * What the mirror needs to know about the downloads to decide what to keep.
 *
 * Handed in by the caller rather than imported: `downloads` already imports
 * this module to mirror the tracklists of what it downloads, and reaching back
 * for it would be a require cycle. `hydrated` is not optional — before the
 * files are read from disk they all look absent, and something downloaded
 * would look disposable.
 */
export interface DownloadsView {
  files: Record<string, string>;
  hydrated: boolean;
}

/** What the mirror is holding, for Settings › About. */
export interface MirrorStats {
  /** Size of the file on disk. */
  bytes: number;
  /** What it was before the first prune, if there was one. */
  prunedFrom?: number;
  albums: number;
  artists: number;
  playlists: number;
  starredSongs: number;
}

const DIR = FileSystem.documentDirectory + 'library-mirror/';

interface MirrorData {
  /** Bytes the file took before the first prune, kept so Settings › About can
   *  say what it was. Written once, by `prune`. */
  prunedFrom?: number;
  starred?: Starred;
  playlists?: Playlist[];
  /** Detail per playlist id: metadata + its complete tracklist. */
  playlistTracks?: Record<string, { playlist: Playlist; songs: Song[] }>;
  /** Detail per album id: metadata + its complete tracklist. */
  albums?: Record<string, { album: Album; songs: Song[] }>;
  /** Detail per artist id: metadata + its albums. */
  artists?: Record<string, { artist: Artist; albums: Album[] }>;
}

function fileFor(auth: SubsonicAuth): string {
  // PRIMARY URL (not the active one): identifies the profile even when switching
  // networks, same as the download directory.
  return `${DIR}${hashKey(`${primaryUrl(auth)}|${auth.username}`)}.json`;
}

function activeFile(): string | null {
  const auth = useAuthStore.getState().auth;
  return auth ? fileFor(auth) : null;
}

interface MirrorState {
  data: MirrorData;
  /** File whose data is loaded in memory (null = none). */
  loadedFile: string | null;
  /** Loads the active profile's mirror (if profile changed, reloads). */
  load: () => Promise<void>;
  saveStarred: (s: Starred) => void;
  savePlaylists: (list: Playlist[]) => void;
  savePlaylistDetail: (id: string, playlist: Playlist, songs: Song[]) => void;
  /** Saves multiple details at once (single disk write). */
  savePlaylistDetails: (entries: { id: string; playlist: Playlist; songs: Song[] }[]) => void;
  /** Applies the "worth keeping" rule to what was already on disk. Needs the
   *  downloads hydrated, so it's called after them. */
  prune: (downloads: DownloadsView) => void;
  /** Size on disk and what's in it, for Settings › About. */
  stats: () => Promise<MirrorStats>;
  saveAlbum: (id: string, album: Album, songs: Song[], downloads: DownloadsView) => void;
  saveArtist: (id: string, artist: Artist, albums: Album[]) => void;
  /** Forces pending writes to disk immediately (on background/offline). */
  flush: () => void;
}

/**
 * Is this album worth keeping offline?
 *
 * The mirror used to keep every album ever opened online, so it grew without
 * end: parsed whole on startup and written whole on every flush, both on the JS
 * thread, so the app got slower the longer it had been used (#50).
 *
 * There are exactly three cases, and only one of them needs this file:
 *
 * - Some songs downloaded and some not. Kept: this is the ONLY place the full
 *   tracklist lives, and without it the missing songs don't even appear greyed
 *   out, the album just looks shorter than it is.
 * - Every song downloaded. Dropped. The download catalog already holds all of
 *   them and `mirrorAlbum` falls back to it, so a copy here is the same
 *   tracklist written twice. This is what a mostly-downloaded library turned
 *   into tens of MB of JSON.
 * - Nothing downloaded. Kept only if favourited, which is what the Library
 *   offers to open offline. Anything else was merely looked at once.
 */
function worthKeepingAlbum(
  album: Album,
  songs: Song[],
  files: Record<string, string>,
): boolean {
  const downloaded = songs.reduce((n, s) => (files[s.id] ? n + 1 : n), 0);
  if (downloaded === 0) return !!album.starred;
  return downloaded < songs.length;
}

/** Artists with downloads are rebuilt offline from the download catalog, so
 *  only the favourited ones need to be here. */
function worthKeepingArtist(artist: Artist): boolean {
  return !!artist.starred;
}

/** The map without `id`, or the same map if it wasn't there. */
function without<T>(map: Record<string, T> | undefined, id: string): Record<string, T> | undefined {
  if (!map || !(id in map)) return map;
  const next = { ...map };
  delete next[id];
  return next;
}

let loadingFile: string | null = null;
let loadPromise: Promise<void> | null = null;
/** Size of the file as it was read, for `prune` to record what it started from. */
let loadedBytes = 0;
// Serializes writes: each save rewrites the entire JSON.
let writeLock: Promise<unknown> = Promise.resolve();
// Saving rewrites the ENTIRE JSON with `JSON.stringify` (synchronous, blocks
// the JS thread), and the mirror grows with use (each viewed album/playlist).
// Before, it was written on EVERY navigation → opening an album or going offline
// would freeze the UI, worse the larger the library. Now it accumulates (`dirty`)
// and flushes ONCE the browsing stops, or immediately on background/offline.
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let dirty = false;
let dirtySince = 0;
// The timer restarts on each save. It used to be armed once and fire four
// seconds later come what may, so browsing a few albums in a row meant a full
// rewrite every four seconds, right in the middle of the browsing. Now the
// write waits for a pause, with a ceiling so it can't be put off forever.
const PERSIST_DEBOUNCE_MS = 4000;
const PERSIST_MAX_WAIT_MS = 30_000;

export const useLibraryMirror = create<MirrorState>((set, get) => {
  function flush() {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (!dirty) return;
    dirty = false;
    dirtySince = 0;
    const file = get().loadedFile;
    if (!file) return;
    const data = get().data;
    writeLock = writeLock.then(async () => {
      try {
        await FileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {});
        const json = timedSync('mirror stringify', () => JSON.stringify(data));
        await timed('mirror write', () => FileSystem.writeAsStringAsync(file, json));
      } catch {
        // If it can't be persisted, this session's mirror is lost on exit.
      }
    });
  }

  function persist() {
    if (!get().loadedFile) return;
    dirty = true;
    if (!dirtySince) dirtySince = Date.now();
    if (Date.now() - dirtySince >= PERSIST_MAX_WAIT_MS) {
      flush();
      return;
    }
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, PERSIST_DEBOUNCE_MS);
  }

  return {
    data: {},
    loadedFile: null,

    load: async () => {
      const file = activeFile();
      if (!file) {
        if (get().loadedFile !== null) {
          flush(); // flushes pending writes for the profile being closed
          set({ data: {}, loadedFile: null });
        }
        return;
      }
      if (get().loadedFile === file) return;
      flush(); // profile switch: persist pending from previous before loading
      if (loadPromise && loadingFile === file) return loadPromise;
      loadingFile = file;
      loadPromise = (async () => {
        let data: MirrorData = {};
        loadedBytes = 0;
        try {
          const info = await FileSystem.getInfoAsync(file);
          if (info.exists) {
            loadedBytes = info.size ?? 0;
            const raw = await timed('mirror read', () =>
              FileSystem.readAsStringAsync(file),
            );
            // Timed apart: this one is the JS thread, and it is the whole file.
            data = timedSync('mirror parse', () => JSON.parse(raw) as MirrorData);
          }
        } catch {
          // Corrupt or missing file: empty mirror.
        }
        set({ data, loadedFile: file });
      })().finally(() => {
        loadPromise = null;
        loadingFile = null;
      });
      return loadPromise;
    },

    saveStarred: (starred) => {
      set({ data: { ...get().data, starred } });
      persist();
    },
    savePlaylists: (playlists) => {
      set({ data: { ...get().data, playlists } });
      persist();
    },
    savePlaylistDetail: (id, playlist, songs) => {
      set({
        data: {
          ...get().data,
          playlistTracks: { ...get().data.playlistTracks, [id]: { playlist, songs } },
        },
      });
      persist();
    },
    savePlaylistDetails: (entries) => {
      if (entries.length === 0) return;
      const next = { ...get().data.playlistTracks };
      for (const e of entries) next[e.id] = { playlist: e.playlist, songs: e.songs };
      set({ data: { ...get().data, playlistTracks: next } });
      persist();
    },
    saveAlbum: (id, album, songs, dl) => {
      const data = get().data;
      if (!worthKeepingAlbum(album, songs, dl.files)) {
        // Before the downloads are read from disk there is no telling a
        // downloaded album from a disposable one, so nothing is thrown away:
        // it just isn't added.
        if (!dl.hydrated) return;
        // Not only skipped: dropped, so unfavouriting something takes it out on
        // its own the next time you look at it.
        const albums = without(data.albums, id);
        if (albums === data.albums) return;
        set({ data: { ...data, albums } });
        persist();
        return;
      }
      set({ data: { ...data, albums: { ...data.albums, [id]: { album, songs } } } });
      persist();
    },
    saveArtist: (id, artist, albums) => {
      const data = get().data;
      if (!worthKeepingArtist(artist)) {
        const artists = without(data.artists, id);
        if (artists === data.artists) return;
        set({ data: { ...data, artists } });
        persist();
        return;
      }
      set({ data: { ...data, artists: { ...data.artists, [id]: { artist, albums } } } });
      persist();
    },
    prune: (dl) => {
      const data = get().data;
      if (!get().loadedFile) return;
      if (!dl.hydrated) return; // everything downloaded would look disposable
      const files = dl.files;
      const albums: NonNullable<MirrorData['albums']> = {};
      for (const [id, e] of Object.entries(data.albums ?? {})) {
        if (worthKeepingAlbum(e.album, e.songs, files)) albums[id] = e;
      }
      const artists: NonNullable<MirrorData['artists']> = {};
      for (const [id, e] of Object.entries(data.artists ?? {})) {
        if (worthKeepingArtist(e.artist)) artists[id] = e;
      }
      const dropped =
        Object.keys(albums).length !== Object.keys(data.albums ?? {}).length ||
        Object.keys(artists).length !== Object.keys(data.artists ?? {}).length;
      if (!dropped) return;
      set({
        data: {
          ...data,
          // Only the first time: what it grew to before any of this existed is
          // the number worth keeping, not the size of the last cleanup.
          prunedFrom: data.prunedFrom ?? loadedBytes,
          albums,
          artists,
        },
      });
      persist();
    },

    stats: async () => {
      const data = get().data;
      const file = get().loadedFile;
      let bytes = 0;
      if (file) {
        try {
          const info = await FileSystem.getInfoAsync(file);
          if (info.exists) bytes = info.size ?? 0;
        } catch {
          // ignore: reported as 0
        }
      }
      return {
        bytes,
        prunedFrom: data.prunedFrom,
        albums: Object.keys(data.albums ?? {}).length,
        artists: Object.keys(data.artists ?? {}).length,
        playlists: Object.keys(data.playlistTracks ?? {}).length,
        starredSongs: data.starred?.songs?.length ?? 0,
      };
    },

    flush,
  };
});

// On background (or close), flush pending writes immediately: the debounce
// might not have fired and we'd lose the last changes if the app is killed.
AppState.addEventListener('change', (s) => {
  if (s !== 'active') useLibraryMirror.getState().flush();
});
