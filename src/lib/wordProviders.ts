/**
 * Word-by-word online lyrics, in the order the person put them in.
 *
 * LRCLIB was the only online source and is still one of them; BiniLyrics
 * (Apple Music TTML), LyricsPlus (the YouLy+ aggregator: Apple, Spotify,
 * Musixmatch) and Unison (the Better Lyrics crowdsourced database) joined it,
 * first synced hit wins. Same shape as the LRCLIB path: each provider reads
 * its own disk cache first, fetches on miss, and saves what it got.
 *
 * Only HTTP calls and our own parsing here: no provider code is vendored
 * (their renderers are AGPL and their components are web-only). TTML answers
 * go through the same `parseTtml` the files on the phone do; the LyricsPlus
 * JSON is mapped onto words below.
 */
import { fetch } from 'expo/fetch';
import * as FileSystem from 'expo-file-system/legacy';

import type { Song, SongLyrics } from '@/api/subsonic';
import { isManualOffline } from '@/api/netGate';
import { hashKey } from './localLibrary';
import { parseTtml } from './ttml';
import { kpoeToLyrics, pickBiniLyricsUrl } from './wordFormats';

export type WordProviderKey = 'binilyrics' | 'lyricsplus' | 'unison' | 'lrclib';

const CACHE_DIR = FileSystem.documentDirectory + 'lyrics-cache/';
const CLIENT_UA = 'Resonus (https://github.com/juananzzz/resonus)';

/** Only in development: where a lookup went, since it never throws. */
function trace(provider: string, what: string, song: Song): void {
  if (__DEV__) console.log(`[lyrics] ${provider} · ${what} · ${song.artist} — ${song.title}`);
}

async function fetchTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctl = new AbortController();
  const id = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(id);
  }
}

async function readCache(file: string): Promise<string | null> {
  try {
    const text = await FileSystem.readAsStringAsync(file);
    return text.trim() ? text : null;
  } catch {
    return null;
  }
}

async function writeCache(file: string, text: string): Promise<void> {
  try {
    await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true }).catch(() => {});
    await FileSystem.writeAsStringAsync(file, text);
  } catch {
    // Without cache we still work; it would just repeat the request.
  }
}

function songOk(song: Song): boolean {
  return !!song.title && !!song.artist;
}

// ── BiniLyrics (Apple Music TTML, no key) ───────────────────────────────────
// https://lyrics.binimum.org/developers: ISRC or track+artist lookup returns
// results with `timing_type` ("word" or "line") and a `lyricsUrl` to TTML
// (picked word-first in `wordFormats`).

async function fetchBiniLyrics(song: Song): Promise<SongLyrics | null> {
  const file = `${CACHE_DIR}${hashKey(song.id)}.binilyrics.ttml`;
  const cached = await readCache(file);
  if (cached) return parseTtml(cached);
  if (!songOk(song) || isManualOffline()) {
    trace('binilyrics', !songOk(song) ? 'not asked: no artist or title' : 'not asked: offline was chosen', song);
    return null;
  }
  try {
    const params = new URLSearchParams();
    const isrc = song.isrc?.[0];
    if (isrc) params.set('isrc', isrc);
    else {
      params.set('track', song.title!);
      params.set('artist', song.artist!);
      if (song.duration) params.set('duration', String(Math.round(song.duration)));
      if (song.album) params.set('album', song.album);
    }
    const res = await fetchTimeout(`https://lyrics-api.binimum.org/?${params}`, {}, 12_000);
    trace('binilyrics', `lookup ${res.status}`, song);
    if (!res.ok) return null;
    const url = pickBiniLyricsUrl((await res.json())?.results);
    if (!url) {
      trace('binilyrics', 'matched nothing', song);
      return null;
    }
    const ttml = await fetchTimeout(url, {}, 12_000);
    if (!ttml.ok) return null;
    const text = await ttml.text();
    const parsed = parseTtml(text);
    if (parsed) void writeCache(file, text);
    return parsed;
  } catch (e) {
    trace('binilyrics', `failed: ${e instanceof Error ? e.message : String(e)}`, song);
    return null;
  }
}

// ── LyricsPlus (the YouLy+ backend, no key) ─────────────────────────────────
// https://github.com/ibratabian17/lyricsplus/blob/cookie/docs/endpoints.md:
// `GET /v2/lyrics/get` answers `{type: "Word"|"Line", lyrics: [...]}` with
// times in milliseconds. Mirrors are tried in order until one answers.

const LYRICPLUS_HOSTS = [
  'https://lyricsplus.binimum.org',
  'https://lyricsplus.atomix.one',
  'https://lyricsplus-seven.vercel.app',
  'https://lyricsplus.prjktla.workers.dev',
  'https://lyrics-plus-backend.vercel.app',
];

async function fetchLyricsPlus(song: Song): Promise<SongLyrics | null> {
  const file = `${CACHE_DIR}${hashKey(song.id)}.lyricsplus.json`;
  const cached = await readCache(file);
  if (cached) {
    try {
      const parsed = kpoeToLyrics(JSON.parse(cached));
      if (parsed) return parsed;
    } catch {
      // A half-written cache is a miss, not lyrics.
    }
  }
  if (!songOk(song) || isManualOffline()) {
    trace('lyricsplus', !songOk(song) ? 'not asked: no artist or title' : 'not asked: offline was chosen', song);
    return null;
  }
  const params = new URLSearchParams({ title: song.title!, artist: song.artist! });
  if (song.album) params.set('album', song.album);
  if (song.duration) params.set('duration', String(song.duration));
  const isrc = song.isrc?.[0];
  if (isrc) params.set('isrc', isrc);
  const headers = {
    'X-Client-Package': 'Resonus <https://github.com/juananzzz/resonus>',
    'User-Agent': CLIENT_UA,
  };
  for (const host of LYRICPLUS_HOSTS) {
    try {
      const res = await fetchTimeout(`${host}/v2/lyrics/get?${params}`, { headers }, 8000);
      trace('lyricsplus', `${host} ${res.status}`, song);
      if (!res.ok) continue;
      const text = await res.text();
      const parsed = kpoeToLyrics(JSON.parse(text));
      if (!parsed) continue;
      void writeCache(file, text);
      return parsed;
    } catch (e) {
      trace('lyricsplus', `${host} failed: ${e instanceof Error ? e.message : String(e)}`, song);
    }
  }
  return null;
}

// ── Unison (Better Lyrics crowdsourced TTML, no key on cache hits) ─────────
// https://lyrics-api-docs.boidu.dev: `GET /getLyrics` answers `{ttml}` with
// syllable-level timing. A 401 (keys enforced on misses) is a miss, not an
// error, and the next provider is tried.

async function fetchUnison(song: Song): Promise<SongLyrics | null> {
  const file = `${CACHE_DIR}${hashKey(song.id)}.unison.ttml`;
  const cached = await readCache(file);
  if (cached) return parseTtml(cached);
  if (!songOk(song) || !song.album || !song.duration || isManualOffline()) {
    trace(
      'unison',
      !songOk(song) ? 'not asked: no artist or title' : !song.album || !song.duration ? 'not asked: needs album and duration' : 'not asked: offline was chosen',
      song,
    );
    return null;
  }
  try {
    const params = new URLSearchParams({
      s: song.title!,
      a: song.artist!,
      al: song.album,
      d: String(Math.round(song.duration)),
    });
    const res = await fetchTimeout(`https://api.betterlyrics.org/getLyrics?${params}`, {}, 12_000);
    trace('unison', `lookup ${res.status}`, song);
    if (!res.ok) return null;
    const text = (await res.json())?.ttml;
    if (typeof text !== 'string' || !text.trim()) return null;
    const parsed = parseTtml(text);
    if (parsed) void writeCache(file, text);
    return parsed;
  } catch (e) {
    trace('unison', `failed: ${e instanceof Error ? e.message : String(e)}`, song);
    return null;
  }
}

const FETCHERS: Record<Exclude<WordProviderKey, 'lrclib'>, (song: Song) => Promise<SongLyrics | null>> = {
  binilyrics: fetchBiniLyrics,
  lyricsplus: fetchLyricsPlus,
  unison: fetchUnison,
};

/**
 * The online providers in the person's order, first synced hit wins. LRCLIB
 * is fetched by the caller (it keeps its own cache file and headers).
 */
export async function fetchWordProviders(
  song: Song,
  order: WordProviderKey[],
  lrclib: () => Promise<SongLyrics | null>,
): Promise<SongLyrics | null> {
  for (const key of order) {
    if (key === 'lrclib') {
      const found = await lrclib();
      if (found) return found;
      continue;
    }
    const found = await FETCHERS[key](song);
    if (found) return found;
  }
  return null;
}
