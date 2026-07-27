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
import { primaryUrl } from '@/lib/serverUrls';
import { useAuthStore } from './auth';
// Cycle with `downloads`, which mirrors the tracklist of what it downloads.
// Both sides only reach for the other inside functions, never while the module
// is being evaluated, so neither sees the other half-built.
import { useDownloads } from './downloads';

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
   *  downloads to be hydrated, so it's called after them. */
  prune: () => void;
  /** Size on disk and what's in it, for Settings › About. */
  stats: () => Promise<MirrorStats>;
  saveAlbum: (id: string, album: Album, songs: Song[]) => void;
  saveArtist: (id: string, artist: Artist, albums: Album[]) => void;
  /** Forces pending writes to disk immediately (on background/offline). */
  flush: () => void;
}

/**
 * Is this album worth keeping offline?
 *
 * The mirror used to keep every album ever opened online, so it grew without
 * end: after months of use it was megabytes that got parsed whole on startup
 * and written whole on every flush, and since that write is a `JSON.stringify`
 * on the JS thread, the app got slower the longer it had been used — and only
 * while online, which is where the writing happens (#50).
 *
 * What it's for, as the module says at the top, is what the Library shows
 * offline: favourites and playlists. Plus whatever has downloads, and that one
 * matters more than it looks: on a half-downloaded album this is the only thing
 * that keeps the full tracklist, with the missing songs greyed out instead of
 * simply gone. An album merely looked at online is none of that.
 */
function worthKeepingAlbum(
  album: Album,
  songs: Song[],
  files: Record<string, string>,
): boolean {
  return !!album.starred || songs.some((s) => !!files[s.id]);
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
        await FileSystem.writeAsStringAsync(file, JSON.stringify(data));
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
            data = JSON.parse(await FileSystem.readAsStringAsync(file)) as MirrorData;
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
    saveAlbum: (id, album, songs) => {
      const data = get().data;
      const dl = useDownloads.getState();
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
    prune: () => {
      const data = get().data;
      if (!get().loadedFile) return;
      const dl = useDownloads.getState();
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
