/**
 * Unified data layer. Screens use these functions instead of calling the
 * Subsonic API directly. The module automatically decides whether to read
 * from the server or the local catalog based on the mode (online/offline).
 */
import { useAuthStore } from '@/store/auth';
import { getDownloadsCatalog, useDownloads } from '@/store/downloads';
import {
  enabledFolderIds,
  profileKeyOf,
  readAlbumCache,
  writeAlbumCache,
} from '@/store/libraries';
import { queryClient } from '@/lib/query';
import { useLibraryMirror } from '@/store/libraryMirror';
import { useOfflineQueue, type QueuePlaylist } from '@/store/offlineQueue';
import { useSettings } from '@/store/settings';
import * as Subsonic from './backend';
import * as Local from '@/lib/localQueries';
import type { Song } from './subsonic';

function isOffline() { return useAuthStore.getState().offline; }
function auth() { return useAuthStore.getState().auth!; }

/** Offline mode WITH a server account (not the local files-only profile):
 *  here the Library is a mirror of the server (see store/libraryMirror). */
function serverOffline(): boolean {
  const s = useAuthStore.getState();
  return s.offline && !!s.auth;
}

/**
 * Marks each song in the mirror as available or not based on downloads:
 * downloaded ones get their `localUri` (played from disk); the rest get
 * `unavailable` (shown grayed out and don't play). In offline mode the
 * set of downloads doesn't change, so the mark is stable during the session.
 *
 * Album art: downloaded art re-pins `coverArt` to `albumId` (the local index
 * goes by albumId). Non-downloaded keeps the server `coverArt`, so the
 * offline URL matches the online one and expo-image serves it from its cache
 * (or downloads it if offline is manual with network); otherwise the placeholder remains.
 */
function annotate(songs: Song[]): Song[] {
  const files = useDownloads.getState().files;
  // Ratings made offline (outbox): override the mirror's rating so they
  // show immediately and persist after refresh or restart, until synced.
  const ratings = useOfflineQueue.getState().data.ratings ?? {};
  // Setting: hide non-downloaded items instead of showing them grayed out.
  const hideUnavailable = useSettings.getState().hideUnavailableOffline;
  const annotated = songs.map((s0) => {
    const s = ratings[s0.id] !== undefined ? { ...s0, userRating: ratings[s0.id] } : s0;
    const uri = files[s.id];
    return uri
      ? { ...s, coverArt: s.albumId ?? s.coverArt, localUri: uri, unavailable: false }
      : { ...s, unavailable: true };
  });
  return hideUnavailable ? annotated.filter((s) => !s.unavailable) : annotated;
}

/** Loads the mirror and the outbox for the profile, and registers the
 *  album art of downloads in the local index (without this, offline album art won't appear). */
async function loadMirror(): Promise<void> {
  await Promise.all([
    useLibraryMirror.getState().load(),
    useOfflineQueue.getState().load(),
    getDownloadsCatalog(),
  ]);
}

/** Looks up a song's metadata by id from available offline sources: outbox
 *  (songs added to playlists), mirror (playlists/albums/favorites), and downloads. */
function resolveSong(id: string, catalog: { songs: Song[] }): Song | undefined {
  const meta = useOfflineQueue.getState().data.songMeta?.[id];
  if (meta) return meta;
  const mirror = useLibraryMirror.getState().data;
  for (const d of Object.values(mirror.playlistTracks ?? {})) {
    const f = d.songs.find((s) => s.id === id);
    if (f) return f;
  }
  for (const d of Object.values(mirror.albums ?? {})) {
    const f = d.songs.find((s) => s.id === id);
    if (f) return f;
  }
  const st = mirror.starred?.songs?.find((s) => s.id === id);
  if (st) return st;
  return catalog.songs.find((s) => s.id === id);
}

/** Final desired tracklist for an offline playlist: the outbox edit if any,
 *  or the mirror's tracklist. */
async function currentPlaylistSongIds(id: string): Promise<string[]> {
  await loadMirror();
  const edited = useOfflineQueue.getState().data.playlists?.[id]?.songIds;
  if (edited) return edited;
  const d = useLibraryMirror.getState().data.playlistTracks?.[id];
  return (d?.songs ?? []).map((s) => s.id);
}

export type { Album, AlbumListType, Artist, ArtistInfo, FolderContents, FolderEntry, MusicFolder, Playlist, RadioStation, SearchResult, Song, StarType, Starred, SubsonicAuth } from './subsonic';
export { normalizeUrl } from './subsonic';

export function coverArtUrl(id: string | undefined, _size?: number): string | undefined {
  // If the album art is downloaded (album/artist on disk), use it even
  // when in server mode: it works offline and doesn't use data, just
  // like audio plays from the downloaded file.
  const local = Local.coverUrl(id);
  if (local) return local;
  if (isOffline()) {
    // Server offline: the server URL as fallback. expo-image serves it
    // from its cache if it was already seen online (or downloads it if
    // offline is manual with network); otherwise the placeholder remains.
    // This way non-downloaded songs/albums show album art even if they
    // can't be played. The local profile (no account) has no server, so
    // there is no fallback there.
    return serverOffline() ? Subsonic.coverArtUrl(auth(), id, _size) : undefined;
  }
  return Subsonic.coverArtUrl(auth(), id, _size);
}

/**
 * "Recently played" with only what was actually played. Servers order that list
 * by play date and let the albums with no play date trail along, so once your
 * history runs out the list is padded with albums you never opened. With
 * several libraries it was blatant: one you had never played still filled its
 * share of the shelf.
 *
 * Only when the server marks plays at all (OpenSubsonic `played`); otherwise
 * there's nothing to tell apart and the list is left exactly as it came.
 */
function onlyPlayed(albums: Subsonic.Album[]): Subsonic.Album[] {
  return albums.some((al) => al.played) ? albums.filter((al) => al.played) : albums;
}

export function getAlbumList(type: Subsonic.AlbumListType = 'newest', size?: number, offset?: number): Promise<Subsonic.Album[]> {
  if (isOffline()) return Local.getAlbumList(type, size, offset);
  const a = auth();
  const ids = enabledFolderIds(a);
  const page = !ids
    ? Subsonic.getAlbumList(a, type, size, offset)
    : ids.length === 1
      ? Subsonic.getAlbumList(a, type, size, offset, ids[0])
      : mergedAlbumPage(a, `albums|${type}`, type, ids, size ?? 20, offset ?? 0, (id, s, o) =>
          Subsonic.getAlbumList(a, type, s, o, id),
        );
  return type === 'recent' ? page.then(onlyPlayed) : page;
}

export function getAlbum(id: string): Promise<{ album: Subsonic.Album; songs: Subsonic.Song[] }> {
  if (isOffline()) {
    if (serverOffline()) return mirrorAlbum(id);
    return Local.getAlbum(id);
  }
  return Subsonic.getAlbum(auth(), id).then((res) => {
    useLibraryMirror.getState().saveAlbum(id, res.album, res.songs);
    return res;
  });
}

async function mirrorAlbum(
  id: string,
): Promise<{ album: Subsonic.Album; songs: Subsonic.Song[] }> {
  await loadMirror();
  const d = useLibraryMirror.getState().data.albums?.[id];
  if (!d) return Local.getAlbum(id);
  return { album: { ...d.album, coverArt: d.album.id }, songs: annotate(d.songs) };
}

export function getArtists(): Promise<Subsonic.Artist[]> {
  if (isOffline()) return Local.getArtists();
  const a = auth();
  const ids = enabledFolderIds(a);
  if (!ids) return Subsonic.getArtists(a);
  if (ids.length === 1) return Subsonic.getArtists(a, ids[0]);
  return Promise.all(ids.map((id) => Subsonic.getArtists(a, id))).then((lists) => {
    const merged = dedupeById(lists.flat());
    merged.sort((x, y) => (x.name ?? '').localeCompare(y.name ?? ''));
    return merged;
  });
}

/** All local albums (offline mode). Only used offline. */
export function getAllAlbums(): Promise<Subsonic.Album[]> {
  return Local.getAllAlbums();
}

/** Re-scan the local catalog (offline mode). */
export function rescanLocal(): Promise<void> {
  return Local.rescan();
}

/** Server genres (global; the API doesn't filter genres by library). */
export function getGenres(): Promise<Subsonic.Genre[]> {
  return Subsonic.getGenres(auth());
}

export function getAlbumsByGenre(genre: string, size?: number, offset?: number): Promise<Subsonic.Album[]> {
  const a = auth();
  const ids = enabledFolderIds(a);
  if (!ids) return Subsonic.getAlbumsByGenre(a, genre, size, offset);
  if (ids.length === 1) return Subsonic.getAlbumsByGenre(a, genre, size, offset, ids[0]);
  return mergedAlbumPage(
    a,
    `byGenre|${genre}`,
    'alphabeticalByName',
    ids,
    size ?? 30,
    offset ?? 0,
    (id, s, o) => Subsonic.getAlbumsByGenre(a, genre, s, o, id),
  );
}

/**
 * Songs tagged with a genre. Not the same list as its albums: tags live per
 * file, so a genre's songs can sit inside albums tagged as something else.
 *
 * With several libraries each is asked for the same page and the results are
 * concatenated: this list has no meaningful global order to merge by (the
 * server returns them however it stores them), so there's nothing to sort.
 */
export function getSongsByGenre(genre: string, count = 50, offset = 0): Promise<Subsonic.Song[]> {
  const a = auth();
  const ids = enabledFolderIds(a);
  if (!ids) return Subsonic.getSongsByGenre(a, genre, count, offset);
  if (ids.length === 1) return Subsonic.getSongsByGenre(a, genre, count, offset, ids[0]);
  return Promise.all(ids.map((id) => Subsonic.getSongsByGenre(a, genre, count, offset, id))).then(
    (lists) => dedupeById(lists.flat()).slice(0, count),
  );
}

// ── Folder navigation (Subsonic servers only; the UI hides it on
// Jellyfin and offline) ───────────────────────────────────────────────────
export function getMusicFolders(): Promise<Subsonic.MusicFolder[]> {
  return Subsonic.getMusicFolders(auth());
}

/** Top-level directories of a library (folder root). */
export function getFolderIndexes(musicFolderId?: string): Promise<Subsonic.FolderEntry[]> {
  return Subsonic.getIndexes(auth(), musicFolderId);
}

/** Contents of a directory: subfolders + songs. */
export function getMusicDirectory(id: string): Promise<Subsonic.FolderContents> {
  return Subsonic.getMusicDirectory(auth(), id);
}

export function getArtist(id: string): Promise<{ artist: Subsonic.Artist; albums: Subsonic.Album[] }> {
  if (isOffline()) {
    if (serverOffline()) return mirrorArtist(id);
    return Local.getArtist(id);
  }
  return Subsonic.getArtist(auth(), id).then((res) => {
    useLibraryMirror.getState().saveArtist(id, res.artist, res.albums);
    return res;
  });
}

async function mirrorArtist(
  id: string,
): Promise<{ artist: Subsonic.Artist; albums: Subsonic.Album[] }> {
  await loadMirror();
  const d = useLibraryMirror.getState().data.artists?.[id];
  if (!d) return Local.getArtist(id);
  // Album art resolved by their id (so they work offline).
  return { artist: d.artist, albums: d.albums.map((al) => ({ ...al, coverArt: al.id })) };
}

export function getArtistInfo(id: string): Promise<Subsonic.ArtistInfo> {
  if (isOffline()) return Promise.resolve(Local.getArtistInfo(id));
  return Subsonic.getArtistInfo(auth(), id);
}

/** Albums where the artist appears without being the album artist. */
export function getAppearsOn(artistId: string, artistName: string): Promise<Subsonic.GuestAlbum[]> {
  if (isOffline()) return Local.getAppearsOn(artistId);
  const a = auth();
  const ids = enabledFolderIds(a);
  if (!ids) return Subsonic.getAppearsOn(a, artistId, artistName);
  if (ids.length === 1) return Subsonic.getAppearsOn(a, artistId, artistName, ids[0]);
  return Promise.all(ids.map((id) => Subsonic.getAppearsOn(a, artistId, artistName, id))).then(
    (lists) => dedupeById(lists.flat()),
  );
}

export function getTopSongs(artist: string, count?: number): Promise<Subsonic.Song[]> {
  if (isOffline()) return Local.getTopSongs(artist, count);
  return Subsonic.getTopSongs(auth(), artist, count);
}

/** Songs similar to a given one (suggestions). Online only. */
export function getSimilarSongs(id: string, count?: number): Promise<Subsonic.Song[]> {
  if (isOffline()) return Promise.resolve([]);
  return Subsonic.getSimilarSongs(auth(), id, count);
}

/** Most played songs (composition over "frequent" albums in Subsonic). */
export function getMostPlayedSongs(size = 50): Promise<Subsonic.Song[]> {
  if (isOffline()) return Local.getMostPlayedSongs(size);
  const a = auth();
  const ids = enabledFolderIds(a);
  if (!ids) return Subsonic.getMostPlayedSongs(a, size);
  if (ids.length === 1) return Subsonic.getMostPlayedSongs(a, size, ids[0]);
  return Promise.all(ids.map((fid) => Subsonic.getMostPlayedSongs(a, size, fid))).then((lists) =>
    dedupeById(lists.flat())
      .sort((x, y) => (y.playCount ?? 0) - (x.playCount ?? 0))
      .slice(0, size),
  );
}

/**
 * Random songs from the library (the Home mix).
 *
 * With multiple active libraries, each one is queried and the result set
 * is re-shuffled: otherwise they'd be grouped by library, which isn't very
 * random.
 */
export function getRandomSongs(size = 200, genre?: string): Promise<Subsonic.Song[]> {
  if (isOffline()) return Local.getRandomSongs(size);
  const a = auth();
  const ids = enabledFolderIds(a);
  if (!ids) return Subsonic.getRandomSongs(a, size, genre);
  if (ids.length === 1) return Subsonic.getRandomSongs(a, size, genre, ids[0]);
  return Promise.all(ids.map((fid) => Subsonic.getRandomSongs(a, size, genre, fid))).then((lists) =>
    shuffled(dedupeById(lists.flat())).slice(0, size),
  );
}

export function getPlaylists(): Promise<Subsonic.Playlist[]> {
  if (isOffline()) {
    if (serverOffline()) return mirrorPlaylists();
    return Local.getPlaylists();
  }
  return Subsonic.getPlaylists(auth()).then((list) => {
    useLibraryMirror.getState().savePlaylists(list);
    // Cache each playlist's tracklist in the background so they are
    // available offline without opening them one by one (non-blocking).
    void prefetchPlaylistDetails(list);
    return list;
  });
}

/** Prevents overlapping prefetch runs (getPlaylists can fire multiple times). */
let prefetchingPlaylists = false;

/**
 * In the background, caches the tracklist of server playlists for offline
 * mode. Skips those that already have details with the same `changed` (cheap
 * after the first sync) and limits concurrency. Best-effort: ignores
 * failures and writes the mirror only once when done.
 */
async function prefetchPlaylistDetails(list: Subsonic.Playlist[]): Promise<void> {
  if (prefetchingPlaylists) return;
  const a = useAuthStore.getState().auth;
  if (!a) return;
  prefetchingPlaylists = true;
  try {
    await loadMirror();
    const cached = useLibraryMirror.getState().data.playlistTracks ?? {};
    // Only those missing or changed on the server (by `changed`).
    const stale = list.filter((p) => {
      const prev = cached[p.id]?.playlist;
      return !prev || (p.changed != null && prev.changed !== p.changed);
    });
    const results: { id: string; playlist: Subsonic.Playlist; songs: Subsonic.Song[] }[] = [];
    const CONCURRENCY = 4;
    for (let i = 0; i < stale.length; i += CONCURRENCY) {
      const batch = stale.slice(i, i + CONCURRENCY);
      const settled = await Promise.all(
        batch.map((p) =>
          Subsonic.getPlaylist(a, p.id)
            .then((res) => ({ id: p.id, playlist: res.playlist, songs: res.songs }))
            .catch(() => null),
        ),
      );
      for (const r of settled) if (r) results.push(r);
    }
    useLibraryMirror.getState().savePlaylistDetails(results);
  } finally {
    prefetchingPlaylists = false;
  }
}

/** Mirror playlists: ALL server playlists that have been seen online (even if
 *  nothing is downloaded); within those, downloaded ones play and the rest are
 *  grayed out. Album art uses the first downloaded track (resolves offline) or
 *  the playlist's own. Without a mirror copy yet, falls back to local behavior. */
async function mirrorPlaylists(): Promise<Subsonic.Playlist[]> {
  await loadMirror();
  const mirror = useLibraryMirror.getState().data;
  const qpls = useOfflineQueue.getState().data.playlists ?? {};
  const catalog = await getDownloadsCatalog();
  const files = useDownloads.getState().files;
  if (!mirror.playlists && Object.keys(qpls).length === 0) return Local.getPlaylists();

  const out: Subsonic.Playlist[] = [];
  // Playlists created offline (still with a temporary id).
  for (const [id, edit] of Object.entries(qpls)) {
    if (!edit.created || edit.deleted) continue;
    const songIds = edit.songIds ?? [];
    const firstDl = songIds.find((sid) => files[sid]);
    out.push({
      id,
      name: edit.name ?? '',
      songCount: songIds.length,
      coverArt: firstDl ? resolveSong(firstDl, catalog)?.albumId : undefined,
      comment: edit.comment,
      public: edit.public,
    });
  }
  // Server playlists with overlay (rename/tracklist), minus deleted ones.
  for (const p of mirror.playlists ?? []) {
    const edit = qpls[p.id];
    if (edit?.deleted) continue;
    const detailIds = mirror.playlistTracks?.[p.id]?.songs.map((s) => s.id);
    const songIds = edit?.songIds ?? detailIds ?? [];
    const firstDl = songIds.find((sid) => files[sid]);
    // With known tracklist (cached details or offline edit) the real count;
    // otherwise, the count provided by the server playlist.
    const haveTracks = edit?.songIds != null || detailIds != null;
    out.push({
      ...p,
      name: edit?.name ?? p.name,
      songCount: haveTracks ? songIds.length : p.songCount,
      // The playlist's own cover comes first: it's the image the user set on
      // the server, and replacing it with the album art of whichever track
      // happened to be downloaded looked like a random cover offline. The
      // downloaded album art is only a fallback for playlists without one,
      // where it's better than nothing.
      coverArt: p.coverArt ?? (firstDl ? resolveSong(firstDl, catalog)?.albumId : undefined),
    });
  }
  return out;
}

export function getStarred(): Promise<Subsonic.Starred> {
  if (isOffline()) {
    if (serverOffline()) return mirrorStarred();
    return Local.getStarred();
  }
  const a = auth();
  const ids = enabledFolderIds(a);
  const p = !ids
    ? Subsonic.getStarred(a)
    : ids.length === 1
      ? Subsonic.getStarred(a, ids[0])
      : Promise.all(ids.map((id) => Subsonic.getStarred(a, id))).then((parts) => ({
          songs: dedupeById(parts.flatMap((x) => x.songs)),
          albums: dedupeById(parts.flatMap((x) => x.albums)),
          artists: dedupeById(parts.flatMap((x) => x.artists)),
        }));
  // Copy for offline mode (Library as server mirror).
  return p.then((s) => {
    useLibraryMirror.getState().saveStarred(s);
    return s;
  });
}

/** Favorites from the mirror (server offline); if no copy exists yet, falls
 *  back to the usual local behavior (derived from downloads).
 *
 *  Favorite songs: all, with non-downloaded ones grayed out. Albums and
 *  artists: all favorited ones (albums without downloads look the same and
 *  open gray/empty, like the rest of non-downloaded content). */
async function mirrorStarred(): Promise<Subsonic.Starred> {
  await loadMirror();
  const mirror = useLibraryMirror.getState().data;
  const catalog = await getDownloadsCatalog();
  await useOfflineQueue.getState().load();
  const favs = useOfflineQueue.getState().data.favs ?? {};
  const hasQueue = Object.keys(favs).length > 0;

  // Base: the server snapshot. If no copy yet but there are offline changes,
  // we start from local to avoid losing favorites made offline.
  const base = mirror.starred ?? (hasQueue ? await Local.getStarred() : null);
  if (!base) return Local.getStarred();

  let songs = base.songs ?? [];
  let albums = base.albums ?? [];
  let artists = base.artists ?? [];

  // Outbox overlay: remove unstarred ones and add those starred offline.
  const unstarred = new Set(
    Object.entries(favs).filter(([, v]) => !v.starred).map(([id]) => id),
  );
  songs = songs.filter((x) => !unstarred.has(x.id));
  albums = albums.filter((x) => !unstarred.has(x.id));
  artists = artists.filter((x) => !unstarred.has(x.id));

  for (const [id, v] of Object.entries(favs)) {
    if (!v.starred) continue;
    if (v.type === 'album') {
      if (!albums.some((x) => x.id === id)) {
        const a = mirror.albums?.[id]?.album ?? catalog.albums.find((x) => x.id === id);
        if (a) albums = [a, ...albums];
      }
    } else if (v.type === 'artist') {
      if (!artists.some((x) => x.id === id)) {
        const a = mirror.artists?.[id]?.artist;
        if (a) artists = [a, ...artists];
      }
    } else if (!songs.some((x) => x.id === id)) {
      const song = resolveSong(id, catalog);
      if (song) songs = [song, ...songs];
    }
  }

  // Favorited albums: ALL of them, even if they have no downloaded songs (they
  // open grayed out like non-downloaded songs, or empty if never seen online).
  // Downloaded ones use their local album art (by id); non-downloaded ones keep
  // the server URL, served from expo-image's cache if seen online (or downloaded
  // if offline is manual with network).
  const downloadedAlbumIds = new Set(catalog.albums.map((a) => a.id));
  albums = albums.map((al) =>
    downloadedAlbumIds.has(al.id) ? { ...al, coverArt: al.id } : al,
  );

  return { songs: annotate(songs), albums, artists };
}

export function star(id: string, type?: Subsonic.StarType): Promise<void> {
  if (isOffline()) {
    // Server offline: recorded in the outbox and uploaded on reconnect.
    if (serverOffline()) {
      useOfflineQueue.getState().setFav(id, type ?? 'song', true);
      return Promise.resolve();
    }
    return Local.starLocal(id, type);
  }
  return Subsonic.star(auth(), id, type);
}

export function unstar(id: string, type?: Subsonic.StarType): Promise<void> {
  if (isOffline()) {
    if (serverOffline()) {
      useOfflineQueue.getState().setFav(id, type ?? 'song', false);
      return Promise.resolve();
    }
    return Local.unstarLocal(id, type);
  }
  return Subsonic.unstar(auth(), id, type);
}

/**
 * Flushes the offline action queue to the server (on reconnect). Best-effort:
 * whatever fails is kept for the next reconnection. Phase 1: favorites.
 */
export async function flushOfflineQueue(auth: Subsonic.SubsonicAuth): Promise<void> {
  const q = useOfflineQueue.getState();
  await q.load();

  // Favorites.
  const favs = q.data.favs ?? {};
  const favFailed: [string, { type: Subsonic.StarType; starred: boolean }][] = [];
  for (const [id, op] of Object.entries(favs)) {
    try {
      if (op.starred) await Subsonic.star(auth, id, op.type);
      else await Subsonic.unstar(auth, id, op.type);
    } catch {
      favFailed.push([id, op]);
    }
  }
  if (Object.keys(favs).length > 0) {
    q.clearFavs();
    for (const [id, op] of favFailed) q.setFav(id, op.type, op.starred);
  }

  // Ratings.
  const ratings = q.data.ratings ?? {};
  const ratingFailed: [string, number][] = [];
  for (const [id, rating] of Object.entries(ratings)) {
    try {
      await Subsonic.setRating(auth, id, rating);
    } catch {
      ratingFailed.push([id, rating]);
    }
  }
  if (Object.keys(ratings).length > 0) {
    q.clearRatings();
    for (const [id, rating] of ratingFailed) q.setRating(id, rating);
  }

  // Playlists. Rewrites the final state of each one (create/delete/rename +
  // full tracklist via reorderPlaylist, which avoids index juggling).
  const playlists = q.data.playlists ?? {};
  const plFailed: [string, QueuePlaylist][] = [];
  for (const [id, edit] of Object.entries(playlists)) {
    try {
      if (edit.created) {
        if (edit.deleted) continue; // created and deleted offline: nothing to upload
        const realId = await Subsonic.createPlaylist(auth, edit.name ?? '');
        if (edit.songIds?.length) await Subsonic.reorderPlaylist(auth, realId, edit.songIds);
        if (edit.comment !== undefined || edit.public !== undefined) {
          await Subsonic.updatePlaylist(auth, realId, {
            comment: edit.comment,
            public: edit.public,
          });
        }
      } else if (edit.deleted) {
        await Subsonic.deletePlaylist(auth, id);
      } else {
        if (edit.name !== undefined || edit.comment !== undefined || edit.public !== undefined) {
          await Subsonic.updatePlaylist(auth, id, {
            name: edit.name,
            comment: edit.comment,
            public: edit.public,
          });
        }
        if (edit.songIds) await Subsonic.reorderPlaylist(auth, id, edit.songIds);
      }
    } catch {
      plFailed.push([id, edit]);
    }
  }
  if (Object.keys(playlists).length > 0) {
    q.clearPlaylists();
    for (const [id, edit] of plFailed) q.setPlaylist(id, edit);
  }
}

/**
 * Snapshots the current state of the React Query cache (playlists,
 * favorites, albums) into the mirror just before going offline. This way, if
 * you edit something online (e.g. remove a song from a playlist) and then go
 * offline without that query being refetched, the mirror reflects the latest
 * seen state instead of sticking with the old server copy.
 */
export function snapshotCachesToMirror(): void {
  const mirror = useLibraryMirror.getState();
  const playlists = queryClient.getQueryData<Subsonic.Playlist[]>(['playlists']);
  if (playlists) mirror.savePlaylists(playlists);
  for (const [key, data] of queryClient.getQueriesData<{
    playlist: Subsonic.Playlist;
    songs: Song[];
  }>({ queryKey: ['playlist'] })) {
    const id = key[1];
    if (typeof id === 'string' && data?.playlist && Array.isArray(data.songs)) {
      mirror.savePlaylistDetail(id, data.playlist, data.songs);
    }
  }
  const starred = queryClient.getQueryData<Subsonic.Starred>(['starred']);
  if (starred) mirror.saveStarred(starred);
  for (const [key, data] of queryClient.getQueriesData<{
    album: Subsonic.Album;
    songs: Song[];
  }>({ queryKey: ['album'] })) {
    const id = key[1];
    if (typeof id === 'string' && data?.album && Array.isArray(data.songs)) {
      mirror.saveAlbum(id, data.album, data.songs);
    }
  }
  // Going offline is a deliberate moment: persist now (a single write,
  // thanks to the debounce) instead of waiting for the timer.
  mirror.flush();
}

/** Rate a song (1-5; 0 removes the rating). */
export function setRating(id: string, rating: number): Promise<void> {
  if (isOffline()) {
    // Server offline: recorded in the outbox and uploaded on reconnect.
    if (serverOffline()) useOfflineQueue.getState().setRating(id, rating);
    return Promise.resolve();
  }
  return Subsonic.setRating(auth(), id, rating);
}

/**
 * Album-only search (for filtering while browsing). Goes to the server because
 * the album list is paginated: filtering client-side would only look at
 * already-loaded pages.
 */
export function searchAlbums(query: string, count?: number): Promise<Subsonic.Album[]> {
  if (isOffline()) return Local.searchAlbums(query, count);
  const a = auth();
  const ids = enabledFolderIds(a);
  if (!ids) return Subsonic.searchAlbums(a, query, count);
  if (ids.length === 1) return Subsonic.searchAlbums(a, query, count, ids[0]);
  return Promise.all(ids.map((id) => Subsonic.searchAlbums(a, query, count, id))).then((parts) =>
    dedupeById(parts.flat()),
  );
}

export function search(query: string): Promise<Subsonic.SearchResult> {
  if (isOffline()) return Local.search(query);
  const a = auth();
  const ids = enabledFolderIds(a);
  if (!ids) return Subsonic.search(a, query);
  if (ids.length === 1) return Subsonic.search(a, query, ids[0]);
  return Promise.all(ids.map((id) => Subsonic.search(a, query, id))).then((parts) => ({
    artists: dedupeById(parts.flatMap((p) => p.artists)),
    albums: dedupeById(parts.flatMap((p) => p.albums)),
    songs: dedupeById(parts.flatMap((p) => p.songs)),
  }));
}

export function scrobble(id: string): Promise<void> {
  if (isOffline()) return Promise.resolve();
  return Subsonic.scrobble(auth(), id);
}

export async function addToPlaylist(playlistId: string, songId: string): Promise<void> {
  if (isOffline()) {
    if (!serverOffline()) return Local.addToPlaylist(playlistId, songId);
    const ids = await currentPlaylistSongIds(playlistId);
    useOfflineQueue.getState().setPlaylist(playlistId, { songIds: [...ids, songId] });
    // Save the song's metadata so it can be displayed in the offline playlist.
    const catalog = await getDownloadsCatalog();
    const song = resolveSong(songId, catalog);
    if (song) useOfflineQueue.getState().rememberSongs([song]);
    return;
  }
  return Subsonic.addToPlaylist(auth(), playlistId, songId);
}

/** Creates an empty playlist and returns its id (temporary if offline). */
export function createPlaylist(name: string): Promise<string> {
  if (isOffline()) {
    if (!serverOffline()) return Local.createPlaylist(name);
    // Temporary id: on reconnect it's created on the server and gets its real id.
    const tmpId = `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    useOfflineQueue.getState().setPlaylist(tmpId, { created: true, name, songIds: [] });
    return Promise.resolve(tmpId);
  }
  return Subsonic.createPlaylist(auth(), name);
}

export async function deletePlaylist(id: string): Promise<void> {
  if (isOffline()) {
    if (!serverOffline()) return Local.deletePlaylist(id);
    await useOfflineQueue.getState().load();
    const entry = useOfflineQueue.getState().data.playlists?.[id];
    // Created offline (never reached the server): just discard it.
    if (entry?.created) useOfflineQueue.getState().removePlaylistEntry(id);
    else useOfflineQueue.getState().setPlaylist(id, { deleted: true });
    return;
  }
  return Subsonic.deletePlaylist(auth(), id);
}

export function getPlaylist(id: string): Promise<{ playlist: Subsonic.Playlist; songs: Subsonic.Song[] }> {
  if (isOffline()) {
    if (serverOffline()) return mirrorPlaylist(id);
    return Local.getPlaylist(id);
  }
  return Subsonic.getPlaylist(auth(), id).then((res) => {
    useLibraryMirror.getState().savePlaylistDetail(id, res.playlist, res.songs);
    return res;
  });
}

async function mirrorPlaylist(
  id: string,
): Promise<{ playlist: Subsonic.Playlist; songs: Subsonic.Song[] }> {
  await loadMirror();
  const mirror = useLibraryMirror.getState().data;
  const catalog = await getDownloadsCatalog();
  const edit = useOfflineQueue.getState().data.playlists?.[id];
  const detail = mirror.playlistTracks?.[id];

  // Playlist metadata: created offline / mirror / at least its name.
  let playlist: Subsonic.Playlist;
  if (edit?.created) {
    playlist = { id, name: edit.name ?? '', comment: edit.comment, public: edit.public };
  } else if (detail) {
    playlist = { ...detail.playlist };
  } else {
    playlist = mirror.playlists?.find((p) => p.id === id) ?? { id, name: id };
  }
  if (edit?.name !== undefined) playlist = { ...playlist, name: edit.name };
  if (edit?.comment !== undefined) playlist = { ...playlist, comment: edit.comment };
  if (edit?.public !== undefined) playlist = { ...playlist, public: edit.public };

  // Tracklist: the outbox edit, or the mirror's.
  const songIds = edit?.songIds ?? detail?.songs.map((s) => s.id);
  if (!songIds) {
    // No saved tracklist nor edit: no songs offline.
    return { playlist: { ...playlist, songCount: 0 }, songs: [] };
  }
  const songs = songIds
    .map((sid) => resolveSong(sid, catalog))
    .filter((s): s is Subsonic.Song => !!s);
  // The count reflects what is actually shown (annotate may hide non-downloaded ones).
  const annotated = annotate(songs);
  return { playlist: { ...playlist, songCount: annotated.length }, songs: annotated };
}

export async function updatePlaylist(
  id: string,
  changes: { name?: string; comment?: string; public?: boolean },
): Promise<void> {
  if (isOffline()) {
    if (!serverOffline()) return Local.updatePlaylist(id, changes);
    const patch: { name?: string; comment?: string; public?: boolean } = {};
    if (changes.name !== undefined) patch.name = changes.name;
    if (changes.comment !== undefined) patch.comment = changes.comment;
    if (changes.public !== undefined) patch.public = changes.public;
    useOfflineQueue.getState().setPlaylist(id, patch);
    return;
  }
  return Subsonic.updatePlaylist(auth(), id, changes);
}

export async function removeFromPlaylist(id: string, index: number): Promise<void> {
  if (isOffline()) {
    if (!serverOffline()) return Local.removeFromPlaylist(id, index);
    const ids = await currentPlaylistSongIds(id);
    useOfflineQueue.getState().setPlaylist(id, { songIds: ids.filter((_, i) => i !== index) });
    return;
  }
  return Subsonic.removeFromPlaylist(auth(), id, index);
}

/** Reorder a playlist's tracks (drag and drop). */
export async function reorderPlaylist(id: string, songIds: string[]): Promise<void> {
  if (isOffline()) {
    if (!serverOffline()) return Local.reorderPlaylist(id, songIds);
    useOfflineQueue.getState().setPlaylist(id, { songIds });
    return;
  }
  return Subsonic.reorderPlaylist(auth(), id, songIds);
}

// ── Multi-library merging (subset mode) ──
//
// The Subsonic API only filters by one library per request, so when multiple
// are active, each is queried and the results are merged here.

/** Shuffles a copy (Fisher-Yates). */
function shuffled<T>(items: T[]): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Deduplicates by id, keeping the first seen. */
function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    out.push(it);
  }
  return out;
}

/**
 * How deep into each library a page is served from, rounded up so the pages of
 * an infinite scroll share one fetch instead of triggering one each.
 */
const MERGE_DEPTH = 100;

// ── Library sizes (for the random pool) ──
//
// The API has no count of its own, but `getArtists` carries `albumCount` per
// artist and takes a library, so one request per library adds up to how many
// albums it holds. Cached well beyond the album lists: this only moves when the
// server scans, not between one shelf and the next.

const LIBRARY_SIZE_TTL_MS = 30 * 60 * 1000;
const librarySizes = new Map<string, { at: number; count: number }>();

/**
 * Albums in one library, 0 if the server doesn't say.
 *
 * An approximation: a server may report an artist's albums across the whole
 * collection rather than within the asked library, so an artist present in two
 * gets counted twice. It's a weight, not a figure anyone is shown.
 */
async function libraryAlbumCount(a: Subsonic.SubsonicAuth, folderId: string): Promise<number> {
  const key = `${profileKeyOf(a)}|${folderId}`;
  const hit = librarySizes.get(key);
  if (hit && Date.now() - hit.at < LIBRARY_SIZE_TTL_MS) return hit.count;
  try {
    const artists = await Subsonic.getArtists(a, folderId);
    const count = artists.reduce((n, ar) => n + (ar.albumCount ?? 0), 0);
    librarySizes.set(key, { at: Date.now(), count });
    return count;
  } catch {
    return 0;
  }
}

/**
 * How much of the random pool each library contributes.
 *
 * Asking every library for the same amount and shuffling the result is still
 * one turn each, only disguised: the pool itself is what's biased, so no
 * shuffle over it can fix the proportions (issue #39). A library holding a
 * twentieth of the music has to bring a twentieth of the pool.
 *
 * Their share of the total, then, with a floor of one so a small library still
 * turns up now and then, and an equal split as the fallback for a server that
 * doesn't report album counts.
 */
async function randomDepths(
  a: Subsonic.SubsonicAuth,
  ids: string[],
  pool: number,
): Promise<number[]> {
  const counts = await Promise.all(ids.map((id) => libraryAlbumCount(a, id)));
  const total = counts.reduce((n, c) => n + c, 0);
  if (total <= 0) return ids.map(() => Math.ceil(pool / ids.length));
  return counts.map((c) => Math.max(1, Math.round(pool * (c / total))));
}

/** First `depth` albums of one library, in chunks the endpoint accepts. */
async function fetchTopAlbums(
  depth: number,
  fetchPage: (size: number, offset: number) => Promise<Subsonic.Album[]>,
): Promise<Subsonic.Album[]> {
  const PAGE = 500; // the endpoint's own cap
  const out: Subsonic.Album[] = [];
  for (let offset = 0; offset < depth; offset += PAGE) {
    const chunk = await fetchPage(Math.min(PAGE, depth - offset), offset);
    out.push(...chunk);
    if (chunk.length < PAGE) break;
  }
  return out;
}

/** Album field each list type is really ordered by, when the server sends it. */
const ALBUM_SORT_FIELD: Partial<
  Record<Subsonic.AlbumListType, 'created' | 'played' | 'playCount'>
> = {
  newest: 'created',
  recent: 'played',
  frequent: 'playCount',
};

/** The field as a number (dates become timestamps) to sort descending by.
 *  Missing sinks to the bottom instead of jumping to the top. */
function albumSortValue(
  album: Subsonic.Album,
  field: 'created' | 'played' | 'playCount',
): number {
  const v = album[field];
  if (v == null) return -Infinity;
  return typeof v === 'number' ? v : (Date.parse(v) || -Infinity);
}

/**
 * Merges per-library lists (each already sorted by the server according to
 * `type`) into ONE list ordered as if the libraries didn't exist.
 *
 * This used to interleave round-robin whenever the album carried no sort key,
 * which is what "recently added" and friends fell into. With libraries of very
 * different sizes that is badly wrong: a tiny library that hasn't changed in a
 * year still takes every other slot, so it crowds out a big one and the same
 * old albums come back forever (issue #39). Albums do carry `created`, and
 * `played`/`playCount` on OpenSubsonic servers, so the merge sorts by those.
 *
 * Round-robin stays as the fallback for a server that sends none of it: with
 * nothing to order by, alternating is still fairer than piling one library
 * ahead of the rest.
 */
function mergeAlbums(perFolder: Subsonic.Album[][], type: Subsonic.AlbumListType): Subsonic.Album[] {
  if (type === 'alphabeticalByName') {
    return dedupeById(perFolder.flat()).sort((a, b) => a.name.localeCompare(b.name));
  }
  if (type === 'alphabeticalByArtist') {
    return dedupeById(perFolder.flat()).sort(
      (a, b) => (a.artist ?? '').localeCompare(b.artist ?? '') || a.name.localeCompare(b.name),
    );
  }
  if (type === 'starred') {
    return dedupeById(perFolder.flat()).sort((a, b) => (b.starred ?? '').localeCompare(a.starred ?? ''));
  }
  const all = dedupeById(perFolder.flat());
  // Random has no order to respect: one shuffle over everything. Interleaving
  // per-library shuffles would still hand out one turn each — and so would
  // shuffling a pool built with the same amount from each, which is why the
  // pool comes weighted by library size (see `randomDepths`).
  if (type === 'random') return shuffled(all);
  const field = ALBUM_SORT_FIELD[type];
  if (field && all.some((al) => al[field] != null)) {
    return all.sort((a, b) => {
      const diff = albumSortValue(b, field) - albumSortValue(a, field);
      // Two albums with nothing to compare: -Infinity minus itself is NaN,
      // which would leave the sort undefined.
      return Number.isNaN(diff) ? 0 : diff;
    });
  }
  // Round-robin interleaving, preserving each library's internal order.
  const interleaved: Subsonic.Album[] = [];
  const max = Math.max(0, ...perFolder.map((f) => f.length));
  for (let i = 0; i < max; i++) {
    for (const folder of perFolder) {
      if (folder[i]) interleaved.push(folder[i]);
    }
  }
  return dedupeById(interleaved);
}

/**
 * Serves a page of the merged list from multiple libraries. The full list
 * is cached for a while to avoid redoing the work on each page of the
 * infinite scroll.
 */
async function mergedAlbumPage(
  a: Subsonic.SubsonicAuth,
  cacheBase: string,
  type: Subsonic.AlbumListType,
  ids: string[],
  size: number,
  offset: number,
  fetchOne: (id: string, size: number, offset: number) => Promise<Subsonic.Album[]>,
): Promise<Subsonic.Album[]> {
  // Only as deep as the page needs. Every library comes back sorted the same
  // way, so the first N of each is guaranteed to contain the first N of the
  // merge — there is no need to walk them whole, which is what this did: to
  // show twenty albums on Home it paginated every library to its end, one
  // request per 500 albums, per library, on every shelf (#50).
  const depth = Math.ceil((offset + size) / MERGE_DEPTH) * MERGE_DEPTH;
  const cacheKey = `${cacheBase}|${profileKeyOf(a)}|${ids.join(',')}|${depth}`;
  let all = readAlbumCache<Subsonic.Album>(cacheKey);
  if (!all) {
    // Same total as the flat depth, split by size instead of equally: for the
    // sorted lists the field decides and taking the first N of each is enough,
    // but a shuffle can only be as fair as the pool it shuffles.
    const depths =
      type === 'random'
        ? await randomDepths(a, ids, depth * ids.length)
        : ids.map(() => depth);
    const perFolder = await Promise.all(
      ids.map((id, i) => fetchTopAlbums(depths[i], (s, o) => fetchOne(id, s, o))),
    );
    all = mergeAlbums(perFolder, type);
    writeAlbumCache(cacheKey, all);
  }
  return all.slice(offset, offset + size);
}
