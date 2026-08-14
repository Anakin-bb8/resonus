/**
 * Last known position per album for audiobook-like content.
 *
 * Stored locally per profile so the app can resume within long-form albums
 * without depending on backend-specific resume APIs.
 */
import { create } from 'zustand';

import { type Song, type SubsonicAuth } from '@/api/subsonic';
import { primaryUrl } from '@/lib/serverUrls';
import { getItem, setItem } from '@/lib/storage';

const STORAGE_KEY = 'resonus.albumProgress';
const WRITE_EVERY_SEC = 30;

const AUDIOBOOK_GENRES = new Set([
  'speech',
  'spoken word',
  'audiobook',
  'audio book',
  'audio drama',
  'audio theatre',
  'audio theater',
  'radio play',
  'radioplay',
  'dramatised',
  'dramatized',
  'narration',
  'narrative',
  'storytelling',
  'podcast',
  'book',
  'book reading',
  'reading',
  'lecture',
  // German variants (umlauts are normalized away in `normGenre`)
  'horbuch',
  'hoerbuch',
  'horspiel',
  'hoerspiel',
  // Common terms across major languages
  'audiolibro',
  'audiolivro',
  'livre audio',
  'luisterboek',
  'ljudbok',
  'lydbok',
  'audiokniha',
  'sesli kitap',
  'audiolivre',
  'lydbog',
  'audiolezen',
  'livro falado',
  'livre parle',
  'lectura dramatizada',
]);

const AUDIOBOOK_SUBGENRES = [
  'fantasy',
  'thriller',
  'psycho thriller',
  'psychothriller',
  'horror',
];

const AUDIOBOOK_KEY_HINTS = new Set([
  // Generic and commonly used names
  'genre',
  'genres',
  'style',
  'styles',
  'tag',
  'tags',
  'category',
  'categories',
  'type',
  'content type',
  'contenttype',
  'content group',
  'contentgroup',
  'grouping',
  'group',
  'mood',
  'moods',
  'description',
  'comment',
  'comments',
  'overview',
  'plot',
  'biography',
  // ID3 / iTunes / Vorbis / APE / WMP mapping aliases seen in Picard docs
  'tcon',
  'tit1',
  'grp1',
  'tmoo',
  'comm',
  'uslt',
  'tmed',
  'txxx musicbrainz album type',
  'musicbrainz album type',
  'musicbrainz album status',
  'musicbrainz album id',
  'musicbrainz track id',
  'musicbrainz recording id',
  'musicbrainz releasegroupid',
  'musicbrainz release group id',
  'musicbrainz albumid',
  'musicbrainz trackid',
  'musicbrainz recordingid',
  'releasetype',
  'release type',
  'release status',
  'releasestatus',
  'podcast',
  'podcasturl',
  'pcst',
  'purl',
  'metadata block picture',
  'wm genre',
  'wm contentgroupdescription',
  'wm mood',
  'wm media',
  'wm description',
  'gen',
  'grp',
  'cmt',
  // Jellyfin local metadata and provider-id style
  'musicbrainzalbumid',
  'musicbrainzalbumartistid',
  'musicbrainzartistid',
  'musicbrainzreleasegroupid',
]);

const AUDIOBOOK_KEYWORD_PARTS = [
  'audiobook',
  'audio book',
  'audio drama',
  'radio play',
  'spoken word',
  'horbuch',
  'hoerbuch',
  'horspiel',
  'hoerspiel',
  'podcast',
  'narration',
  'dramatis',
];

const AUDIOBOOK_META_VALUE_HINTS = [
  'audiobook',
  'audio book',
  'spoken word',
  'audio drama',
  'radio play',
  'podcast',
  'narration',
  'narrated',
  'unabridged',
  'abridged',
  'chapter',
  'chapters',
  'horbuch',
  'hoerbuch',
  'horspiel',
  'hoerspiel',
];

export interface AlbumProgressEntry {
  trackId: string;
  positionSec: number;
  updatedAt: number;
}

type AlbumProgressByProfile = Record<string, Record<string, AlbumProgressEntry>>;

interface AlbumProgressState {
  byProfile: AlbumProgressByProfile;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  clearAll: () => void;
  clearAlbum: (
    auth: SubsonicAuth | null | undefined,
    offline: boolean,
    albumId: string,
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

function normGenre(v: string): string {
  return v
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitMetaValues(v: string): string[] {
  return v
    .split(/[\n;,|/]+/)
    .map((p) => normGenre(p))
    .filter(Boolean);
}

function hasAudiobookValue(v: string): boolean {
  const n = normGenre(v);
  if (!n) return false;
  if (
    AUDIOBOOK_GENRES.has(n) ||
    n.includes('audiobook') ||
    n.includes('audio book') ||
    (n.includes('spoken') && n.includes('word')) ||
    AUDIOBOOK_SUBGENRES.some((g) => n.includes(g))
  ) {
    return true;
  }
  return AUDIOBOOK_META_VALUE_HINTS.some((hint) => n.includes(hint));
}

function isAudiobookKey(k: string): boolean {
  const n = normGenre(k);
  if (!n) return false;
  if (AUDIOBOOK_KEY_HINTS.has(n)) return true;
  return AUDIOBOOK_KEYWORD_PARTS.some((part) => n.includes(part));
}

function parseKeyValueMeta(input: string): Array<{ key: string; value: string }> {
  const out: Array<{ key: string; value: string }> = [];
  const re = /([^\n:;=|]{2,60})\s*[:=]\s*([^\n|;]{1,200})/g;
  for (const match of input.matchAll(re)) {
    const key = match[1]?.trim();
    const value = match[2]?.trim();
    if (!key || !value) continue;
    out.push({ key, value });
  }
  return out;
}

function isAudiobookGenre(v: string): boolean {
  return hasAudiobookValue(v);
}

export function isAudiobookSong(song: Song | null | undefined): boolean {
  if (!song) return false;

  const directValues = [
    song.genre ?? '',
    ...(song.genres ?? []).map((g) => g.name),
    ...(song.moods ?? []),
    song.comment ?? '',
    song.title ?? '',
    song.album ?? '',
  ];

  if (directValues.some((v) => v && isAudiobookGenre(v))) return true;

  // Many tools export opaque metadata chunks in comment-like fields.
  // Parse key/value pairs such as "RELEASETYPE=Audiobook" or "genre: spoken word".
  for (const text of [song.comment ?? '', ...song.moods ?? []]) {
    if (!text) continue;
    for (const entry of parseKeyValueMeta(text)) {
      if (isAudiobookKey(entry.key) && hasAudiobookValue(entry.value)) return true;
      if (hasAudiobookValue(entry.key) && isAudiobookKey(entry.value)) return true;
      const splitValues = splitMetaValues(entry.value);
      if (isAudiobookKey(entry.key) && splitValues.some((v) => hasAudiobookValue(v))) return true;
    }
  }

  return false;
}

function profileKey(auth: SubsonicAuth | null | undefined, offline: boolean): string {
  if (auth) return `${primaryUrl(auth)}|${auth.username}|${auth.serverType}`;
  return offline ? 'offline' : 'local';
}

export function getAlbumProgressEntry(
  auth: SubsonicAuth | null | undefined,
  offline: boolean,
  albumId: string,
): AlbumProgressEntry | undefined {
  const key = profileKey(auth, offline);
  return useAlbumProgress.getState().byProfile[key]?.[albumId];
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave(byProfile: AlbumProgressByProfile) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void setItem(STORAGE_KEY, JSON.stringify(byProfile));
  }, 1000);
}

export const useAlbumProgress = create<AlbumProgressState>((set, get) => ({
  byProfile: {},
  hydrated: false,

  clearAll: () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    set({ byProfile: {} });
    void setItem(STORAGE_KEY, JSON.stringify({}));
  },

  clearAlbum: (auth, offline, albumId) => {
    const key = profileKey(auth, offline);
    const prevProfile = get().byProfile[key];
    if (!prevProfile?.[albumId]) return;
    const { [albumId]: _removed, ...nextProfile } = prevProfile;
    const byProfile = { ...get().byProfile, [key]: nextProfile };
    set({ byProfile });
    scheduleSave(byProfile);
  },

  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const raw = await getItem(STORAGE_KEY);
      if (raw) set({ byProfile: JSON.parse(raw) as AlbumProgressByProfile });
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
    scheduleSave(byProfile);
  },
}));
