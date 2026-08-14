/**
 * Which albums are audiobooks, and how far into each one you got.
 *
 * Both are kept on the phone, per profile. The position has to be: the
 * Subsonic API has nowhere to put a resume point, which is why Symfonium
 * keeps its own too, and OpenSubsonic has not filled the gap yet. The mark
 * could in principle come from the server, and where the files are tagged it
 * does, but only as a starting answer (see `isAudiobook`).
 *
 * The mark is a mark and not a guess on purpose. This started out sniffing
 * genres, titles and album names for words like audiobook, chapter, thriller
 * and fantasy, which called Thriller an audiobook and Chapter 24 a chapter of
 * one. Every app that does this properly has somebody declare it instead:
 * Jellyfin and Audiobookshelf by the kind of library you build, Symfonium by
 * marking a library in its provider settings, Spotify not at all because its
 * catalogue hands it the answer. Here it is per album, because a library is
 * the wrong unit for a server where most people have exactly one.
 *
 * What that buys, beyond being right, is that an album nobody marked behaves
 * exactly as it always did: same label, same play button, same autoplay. The
 * audiobook behaviour cannot leak into the other two thousand records.
 */
import { create } from 'zustand';

import { type Album, type SubsonicAuth } from '@/api/subsonic';
import { queryClient } from '@/lib/query';
import { releaseGroupOf, type ReleaseGroup } from '@/lib/releaseGroups';
import { primaryUrl } from '@/lib/serverUrls';
import { getItem, setItem } from '@/lib/storage';

const STORAGE_KEY = 'resonus.albumProgress';
const WRITE_EVERY_SEC = 30;

/**
 * The release types that mean "not music", in `releaseGroupOf`'s spelling.
 *
 * Where a library is tagged this is what the album is marked as to begin
 * with, and asking it is what ztx asked for on #144: MusicBrainz's
 * `RELEASETYPE` already arrives with every album and `lib/releaseGroups`
 * already reads it to split a discography, so nothing extra is fetched. It is
 * the default and not the verdict, since marking it by hand has to be able to
 * disagree in both directions.
 */
const AUDIOBOOK_RELEASE_GROUPS = new Set<ReleaseGroup>([
  'audiobook',
  'audiodrama',
  'spokenword',
]);

export interface AlbumProgressEntry {
  trackId: string;
  positionSec: number;
  updatedAt: number;
}

type AlbumProgressByProfile = Record<string, Record<string, AlbumProgressEntry>>;
/** Per profile, per album: what the tag said was overruled to. */
type MarkedByProfile = Record<string, Record<string, boolean>>;

interface Persisted {
  byProfile: AlbumProgressByProfile;
  marked: MarkedByProfile;
}

interface AlbumProgressState {
  byProfile: AlbumProgressByProfile;
  marked: MarkedByProfile;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  clearAll: () => void;
  clearAlbum: (
    auth: SubsonicAuth | null | undefined,
    offline: boolean,
    albumId: string,
  ) => void;
  /** Marks an album as an audiobook, or as not one. */
  setAudiobook: (
    auth: SubsonicAuth | null | undefined,
    offline: boolean,
    albumId: string,
    value: boolean,
  ) => void;
  remember: (
    auth: SubsonicAuth | null | undefined,
    offline: boolean,
    albumId: string,
    trackId: string,
    positionSec: number,
    force?: boolean,
  ) => void;
}

function profileKey(auth: SubsonicAuth | null | undefined, offline: boolean): string {
  if (auth) return `${primaryUrl(auth)}|${auth.username}|${auth.serverType}`;
  return offline ? 'offline' : 'local';
}

/** What the record's own tag says, with nobody having had an opinion yet. */
function taggedAsAudiobook(album: Album | null | undefined): boolean {
  return !!album && AUDIOBOOK_RELEASE_GROUPS.has(releaseGroupOf(album));
}

/**
 * Whether an album is an audiobook: what you said, or what the tag says.
 *
 * Absent from `marked` means nobody has been asked, so the tag answers. Once
 * marked, the mark wins in both directions: a tagged record can be told it is
 * music, which matters because a MusicBrainz `spokenword` covers poetry and
 * comedy albums that nobody wants a resume point on.
 */
export function isAudiobook(
  auth: SubsonicAuth | null | undefined,
  offline: boolean,
  album: Album | null | undefined,
): boolean {
  if (!album) return false;
  const mark = useAlbumProgress.getState().marked[profileKey(auth, offline)]?.[album.id];
  return mark ?? taggedAsAudiobook(album);
}

/**
 * The same question from the player, which holds songs and not albums.
 *
 * A song carries no release type, so where the album has not been marked the
 * album itself is read out of the query cache and never fetched: whatever put
 * this queue together went through `['album', id]` to get its songs, so the
 * tagged answer is usually already sitting there.
 */
export function isAudiobookAlbumId(
  auth: SubsonicAuth | null | undefined,
  offline: boolean,
  albumId: string | null | undefined,
): boolean {
  if (!albumId) return false;
  const mark = useAlbumProgress.getState().marked[profileKey(auth, offline)]?.[albumId];
  if (mark !== undefined) return mark;
  const cached = queryClient.getQueryData<{ album: Album }>(['album', albumId]);
  return taggedAsAudiobook(cached?.album);
}

export function getAlbumProgressEntry(
  auth: SubsonicAuth | null | undefined,
  offline: boolean,
  albumId: string,
): AlbumProgressEntry | undefined {
  const key = profileKey(auth, offline);
  return useAlbumProgress.getState().byProfile[key]?.[albumId];
}

const NO_PROGRESS: Record<string, AlbumProgressEntry> = {};
const NO_MARKS: Record<string, boolean> = {};

/**
 * Everything saved for a profile, for a screen that needs to hear it change.
 *
 * `getAlbumProgressEntry` and `isAudiobook` read the store once and tell
 * nobody, so a screen calling them while it renders shows whatever was saved
 * the last time something else made it draw: the album you have been
 * listening to still offers to resume where it stood two chapters ago, and
 * marking one as an audiobook changes nothing until you leave and come back.
 *
 * The whole profile rather than one album because the id to look up is the
 * one the server answered with, which a screen only has after its query has
 * come back, and the album a request was made for is not always the album
 * that arrives (Navidrome hands back canonical ids).
 */
export function useAlbumProgressByAlbum(
  auth: SubsonicAuth | null | undefined,
  offline: boolean,
): Record<string, AlbumProgressEntry> {
  const key = profileKey(auth, offline);
  return useAlbumProgress((s) => s.byProfile[key] ?? NO_PROGRESS);
}

export function useAudiobookMarks(
  auth: SubsonicAuth | null | undefined,
  offline: boolean,
): Record<string, boolean> {
  const key = profileKey(auth, offline);
  return useAlbumProgress((s) => s.marked[key] ?? NO_MARKS);
}

/** The mark a screen should show, given the marks it is subscribed to. */
export function markedAsAudiobook(
  marks: Record<string, boolean>,
  album: Album | null | undefined,
): boolean {
  if (!album) return false;
  return marks[album.id] ?? taggedAsAudiobook(album);
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave(state: Persisted) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void setItem(STORAGE_KEY, JSON.stringify(state));
  }, 1000);
}

export const useAlbumProgress = create<AlbumProgressState>((set, get) => ({
  byProfile: {},
  marked: {},
  hydrated: false,

  // Only the positions. The marks are what you told the app your library is,
  // which a button called "delete progress" has no business throwing away.
  clearAll: () => {
    const marked = get().marked;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    set({ byProfile: {} });
    void setItem(STORAGE_KEY, JSON.stringify({ byProfile: {}, marked }));
  },

  clearAlbum: (auth, offline, albumId) => {
    const key = profileKey(auth, offline);
    const prevProfile = get().byProfile[key];
    if (!prevProfile?.[albumId]) return;
    const { [albumId]: _removed, ...nextProfile } = prevProfile;
    const byProfile = { ...get().byProfile, [key]: nextProfile };
    set({ byProfile });
    scheduleSave({ byProfile, marked: get().marked });
  },

  setAudiobook: (auth, offline, albumId, value) => {
    const key = profileKey(auth, offline);
    const marked = {
      ...get().marked,
      [key]: { ...(get().marked[key] ?? {}), [albumId]: value },
    };
    // Saying it is not an audiobook drops the position with it: what is left
    // of it is an album that would sit there offering to resume a book you
    // just said is not one.
    const prevProfile = get().byProfile[key];
    let byProfile = get().byProfile;
    if (!value && prevProfile?.[albumId]) {
      const { [albumId]: _removed, ...nextProfile } = prevProfile;
      byProfile = { ...byProfile, [key]: nextProfile };
    }
    set({ marked, byProfile });
    scheduleSave({ byProfile, marked });
  },

  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const raw = await getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Persisted>;
        set({ byProfile: parsed.byProfile ?? {}, marked: parsed.marked ?? {} });
      }
    } catch {
      // ignore corrupted/missing data
    } finally {
      set({ hydrated: true });
    }
  },

  remember: (auth, offline, albumId, trackId, positionSec, force = false) => {
    const sec = Number.isFinite(positionSec) ? Math.max(0, Math.round(positionSec)) : 0;
    const key = profileKey(auth, offline);
    const prevProfile = get().byProfile[key] ?? {};
    const prev = prevProfile[albumId];
    if (
      !force &&
      prev &&
      prev.trackId === trackId &&
      Math.abs(prev.positionSec - sec) < WRITE_EVERY_SEC
    ) {
      return;
    }
    const nextProfile = {
      ...prevProfile,
      [albumId]: { trackId, positionSec: sec, updatedAt: Date.now() },
    };
    const byProfile = { ...get().byProfile, [key]: nextProfile };
    set({ byProfile });
    scheduleSave({ byProfile, marked: get().marked });
  },
}));
