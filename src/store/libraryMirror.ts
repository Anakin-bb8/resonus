/**
 * Server library mirror for offline mode.
 *
 * While online, viewing favorites, playlists, an album or an artist saves a
 * copy (per profile, like the download catalog). Offline with a server
 * account, the Library screen reads from here and marks each song as available
 * (downloaded) or not.
 *
 * It is NOT a mirror of the ENTIRE library: only favorited items, playlists and
 * whatever has downloads, which is what the Library screen shows. What was
 * never seen online won't be there.
 *
 * It lives in SQLite now (see `lib/mirrorDb`). It used to be one JSON file
 * rewritten in full for any change, and that is where its size limits came
 * from: playlists over five hundred songs left out, albums already downloaded
 * left out, purely to keep the file writable (#50). Those are gone. What
 * remains is a rule about what belongs here, which is a different thing.
 */
import * as FileSystem from 'expo-file-system/legacy';
import { create } from 'zustand';

import type { Album, Artist, Playlist, Song, Starred, SubsonicAuth } from '@/api/subsonic';
import { hashKey } from '@/lib/localLibrary';
import * as Db from '@/lib/mirrorDb';
import { primaryUrl } from '@/lib/serverUrls';
import { useAuthStore } from './auth';

export type { AlbumDetail, ArtistDetail, PlaylistDetail } from '@/lib/mirrorDb';

/**
 * What the mirror needs to know about the downloads to decide what to keep.
 *
 * Handed in by the caller rather than imported: `downloads` already imports
 * this module to mirror the tracklists of what it downloads, and reaching back
 * for it would be a require cycle. `hydrated` is not optional: before the
 * files are read from disk they all look absent, and something downloaded
 * would look disposable.
 */
export interface DownloadsView {
  files: Record<string, string>;
  hydrated: boolean;
}

export interface MirrorStats extends Db.MirrorStats {
  /** Only set when a cleanup happened, for the settings screen to mention it. */
  prunedFrom?: number;
}

const DIR = FileSystem.documentDirectory + 'library-mirror/';

/** Where the active profile's mirror lives, or null without a session. */
function active(): { dir: string; file: string } | null {
  const auth: SubsonicAuth | null = useAuthStore.getState().auth;
  if (!auth) return null;
  // PRIMARY URL (not the active one): identifies the profile even when
  // switching networks, same as the download directory.
  const name = hashKey(`${primaryUrl(auth)}|${auth.username}`);
  return { dir: DIR, file: `${DIR}${name}.json` };
}

/**
 * Is this album worth keeping offline?
 *
 * The mirror used to keep every album ever opened online, so it grew without
 * end (#50). What it is for is what the Library offers offline: favourites,
 * playlists, and whatever has downloads. That last one earns its place on a
 * half-downloaded album, where this is the only place the full tracklist
 * lives: without it the missing songs don't appear greyed out, the album just
 * looks shorter than it is.
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

/** Same list, as far as anything here cares: same length and same ends. Cheap
 *  on purpose, since the alternative is comparing thousands of songs. */
function sameEnds<T extends { id: string }>(a: T[] | undefined, b: T[] | undefined): boolean {
  if (!a || !b || a.length !== b.length) return false;
  if (a.length === 0) return true;
  return a[0].id === b[0].id && a[a.length - 1].id === b[b.length - 1].id;
}

function sameLists(a: Starred | undefined, b: Starred): boolean {
  return (
    !!a && sameEnds(a.songs, b.songs) && sameEnds(a.albums, b.albums) && sameEnds(a.artists, b.artists)
  );
}

function samePlaylists(a: Playlist[] | undefined, b: Playlist[]): boolean {
  if (!sameEnds(a, b)) return false;
  // A playlist can change without the list changing, and `changed` says so.
  return (a ?? []).every((p, i) => p.changed === b[i].changed);
}

/** Runs against the active profile's mirror, or gives up quietly. */
async function withMirror<T>(
  fn: (dir: string, file: string) => Promise<T>,
  fallback: T,
): Promise<T> {
  const target = active();
  if (!target) return fallback;
  try {
    return await fn(target.dir, target.file);
  } catch {
    // A mirror that can't be read or written is a degraded offline mode, not
    // a reason to take the screen down with it.
    return fallback;
  }
}

interface MirrorState {
  /** Profile whose mirror is open (empty = none). */
  profile: string;
  /** Opens the active profile's mirror, migrating its JSON the first time. */
  load: () => Promise<void>;
  saveStarred: (s: Starred) => void;
  savePlaylists: (list: Playlist[]) => void;
  savePlaylistDetail: (id: string, playlist: Playlist, songs: Song[]) => void;
  savePlaylistDetails: (entries: { id: string; playlist: Playlist; songs: Song[] }[]) => void;
  saveAlbum: (id: string, album: Album, songs: Song[], downloads: DownloadsView) => void;
  saveArtist: (id: string, artist: Artist, albums: Album[]) => void;
  /** Applies the "worth keeping" rule to what is already stored. Needs the
   *  downloads hydrated, so it is called after them. */
  prune: (downloads: DownloadsView) => Promise<void>;
  /** Size and contents, for Settings › Downloads. */
  stats: () => Promise<MirrorStats>;

  // Reads. All of them go to the database: nothing is held in memory any more,
  // which is what a whole library sitting in a JS object used to cost.
  starred: () => Promise<Starred | undefined>;
  playlists: () => Promise<Playlist[] | undefined>;
  playlistDetail: (id: string) => Promise<Db.PlaylistDetail | undefined>;
  albumDetail: (id: string) => Promise<Db.AlbumDetail | undefined>;
  artistDetail: (id: string) => Promise<Db.ArtistDetail | undefined>;
  song: (id: string) => Promise<Song | undefined>;
  songs: (ids: string[]) => Promise<Map<string, Song>>;
  playlistVersions: () => Promise<Record<string, string | undefined>>;
}

export const useLibraryMirror = create<MirrorState>((set, get) => ({
  profile: '',

  load: async () => {
    const target = active();
    if (!target) {
      await Db.closeMirror();
      set({ profile: '' });
      return;
    }
    if (get().profile === target.file) return;
    if (get().profile) await Db.closeMirror(); // another profile's was open
    await Db.mirrorDb(target.dir, target.file).catch(() => {});
    set({ profile: target.file });
  },

  saveStarred: (starred) => {
    // Favourites are fetched again and again and almost always come back
    // identical. Each of those used to dirty the file and cost a full rewrite,
    // measured at thirty seven seconds on a large mirror (#50).
    void withMirror(async (dir, file) => {
      if (sameLists(await Db.getStarred(dir, file), starred)) return;
      await Db.saveEntry(dir, file, 'starred', '', starred, starred.songs);
    }, undefined);
  },

  savePlaylists: (playlists) => {
    void withMirror(async (dir, file) => {
      if (samePlaylists(await Db.getPlaylists(dir, file), playlists)) return;
      await Db.saveEntry(dir, file, 'playlists', '', playlists);
    }, undefined);
  },

  savePlaylistDetail: (id, playlist, songs) => {
    void withMirror(
      (dir, file) => Db.saveEntry(dir, file, 'playlist', id, { playlist, songs }, songs),
      undefined,
    );
  },

  savePlaylistDetails: (entries) => {
    if (entries.length === 0) return;
    void withMirror(async (dir, file) => {
      for (const e of entries) {
        await Db.saveEntry(
          dir,
          file,
          'playlist',
          e.id,
          { playlist: e.playlist, songs: e.songs },
          e.songs,
        );
      }
    }, undefined);
  },

  saveAlbum: (id, album, songs, dl) => {
    void withMirror(async (dir, file) => {
      if (worthKeepingAlbum(album, songs, dl.files)) {
        await Db.saveEntry(dir, file, 'album', id, { album, songs }, songs);
        return;
      }
      // Before the downloads are read from disk there is no telling a
      // downloaded album from a disposable one, so nothing is thrown away.
      if (!dl.hydrated) return;
      // Dropped, not merely skipped, so unfavouriting takes it out on its own
      // the next time it is looked at.
      await Db.dropEntry(dir, file, 'album', id);
    }, undefined);
  },

  saveArtist: (id, artist, albums) => {
    void withMirror(async (dir, file) => {
      if (worthKeepingArtist(artist)) {
        await Db.saveEntry(dir, file, 'artist', id, { artist, albums });
        return;
      }
      await Db.dropEntry(dir, file, 'artist', id);
    }, undefined);
  },

  prune: async (dl) => {
    if (!dl.hydrated) return; // everything downloaded would look disposable
    await withMirror(async (dir, file) => {
      const db = await Db.mirrorDb(dir, file);
      const albums = await db.getAllAsync<{ id: string; data: string }>(
        "SELECT id, data FROM entries WHERE kind = 'album'",
      );
      for (const row of albums) {
        const d = JSON.parse(row.data) as Db.AlbumDetail;
        if (!worthKeepingAlbum(d.album, d.songs, dl.files)) {
          await Db.dropEntry(dir, file, 'album', row.id);
        }
      }
      const artists = await db.getAllAsync<{ id: string; data: string }>(
        "SELECT id, data FROM entries WHERE kind = 'artist'",
      );
      for (const row of artists) {
        const d = JSON.parse(row.data) as Db.ArtistDetail;
        if (!worthKeepingArtist(d.artist)) await Db.dropEntry(dir, file, 'artist', row.id);
      }
    }, undefined);
  },

  stats: () =>
    withMirror((dir, file) => Db.stats(dir, file), {
      bytes: 0,
      albums: 0,
      artists: 0,
      playlists: 0,
      starredSongs: 0,
    }),

  starred: () => withMirror((d, f) => Db.getStarred(d, f), undefined),
  playlists: () => withMirror((d, f) => Db.getPlaylists(d, f), undefined),
  playlistDetail: (id) => withMirror((d, f) => Db.getPlaylistDetail(d, f, id), undefined),
  albumDetail: (id) => withMirror((d, f) => Db.getAlbumDetail(d, f, id), undefined),
  artistDetail: (id) => withMirror((d, f) => Db.getArtistDetail(d, f, id), undefined),
  song: (id) => withMirror((d, f) => Db.getSong(d, f, id), undefined),
  songs: (ids) => withMirror((d, f) => Db.getSongs(d, f, ids), new Map<string, Song>()),
  playlistVersions: () => withMirror((d, f) => Db.playlistVersions(d, f), {}),
}));
