/**
 * Lyrics for local/offline music, in order of preference:
 *
 * 1. `.ttml` or `.lrc` file next to the audio file (same name), in that order
 *    as Navidrome reads them. Also covers downloads: when downloading a song
 *    the server lyrics are cached in the `.lrc`.
 * 2. Embedded lyrics in the file itself (ID3 USLT frame).
 * 3. Online, only with the providers the user turned on (see
 *    `OnlineProviders`). The result is cached to disk to avoid re-fetching.
 */
// Not the global `fetch`: it never resolves in the background. See the note
// in `src/api/subsonic.ts`.
import { fetch } from 'expo/fetch';
import * as FileSystem from 'expo-file-system/legacy';

import { type Song, type SongLyrics } from '@/api/subsonic';
import { hashKey, readTags } from './localLibrary';
import { parseLrc } from './lrc';
import { parseTtml } from './ttml';
import { isManualOffline } from '@/api/netGate';

const LRCLIB_CACHE_DIR = FileSystem.documentDirectory + 'lyrics-cache/';
/** Who is asking, for LRCLIB and lrc.red. Sent as both headers to LRCLIB: see `fetchLrclib`. */
const CLIENT_UA = 'Resonus (https://github.com/juananzzz/resonus)';
const AUDIO_EXT_RE = /\.[a-z0-9]{1,5}$/i;

/** URI of a sibling file next to an audio file (works for `file://` and SAF). */
function siblingUri(audioUri: string, ext: string): string | null {
  if (!AUDIO_EXT_RE.test(audioUri)) return null;
  return audioUri.replace(AUDIO_EXT_RE, ext);
}

/** URI of the sibling `.lrc` next to an audio file. */
export function siblingLrcUri(audioUri: string): string | null {
  return siblingUri(audioUri, '.lrc');
}

/** Reads a text file; null if it doesn't exist or can't be read. */
async function readTextIfExists(uri: string): Promise<string | null> {
  try {
    const text = await FileSystem.readAsStringAsync(uri);
    return text.trim() ? text : null;
  } catch {
    return null;
  }
}

/** Reads on-device lyrics only: sibling `.ttml`, `.lrc`, then embedded USLT. */
async function getFileLyrics(song: Song): Promise<SongLyrics | null> {
  const uri = song.localUri;
  if (!uri) return null;
  // 1) .ttml next to the audio file, ahead of the .lrc: with both there, it is
  // the one timed word by word (#165).
  const ttmlUri = siblingUri(uri, '.ttml');
  const ttmlText = ttmlUri ? await readTextIfExists(ttmlUri) : null;
  const fromTtml = ttmlText ? parseTtml(ttmlText) : null;
  if (fromTtml) return fromTtml;

  // 2) .lrc next to the audio file.
  const lrcUri = siblingLrcUri(uri);
  const lrcText = lrcUri ? await readTextIfExists(lrcUri) : null;
  const fromFile = lrcText ? parseLrc(lrcText) : null;
  if (fromFile) return fromFile;

  // 3) Embedded USLT (may contain LRC-style timestamps inside).
  const tags = await readTags(uri);
  return tags?.lyrics ? parseLrc(tags.lyrics) : null;
}

/** The online lyrics services the user turned on (Settings › Player › Lyrics). */
export interface OnlineProviders {
  lrclib: boolean;
  lrcRed: boolean;
}

export const NO_ONLINE: OnlineProviders = { lrclib: false, lrcRed: false };

export function anyOnline(p: OnlineProviders): boolean {
  return p.lrclib || p.lrcRed;
}

/**
 * Local/offline lyrics. Normally on-device first with the online providers as
 * fallback; with `preferOnline` the order flips (online first, on-device as
 * fallback). Nothing online is asked unless a provider is on.
 */
export async function getLocalLyrics(
  song: Song,
  online: OnlineProviders,
  preferOnline = false,
): Promise<SongLyrics | null> {
  if (anyOnline(online) && preferOnline) {
    return (await getOnlineLyrics(song, online)) ?? (await getFileLyrics(song));
  }
  const fromFile = await getFileLyrics(song);
  if (fromFile) return fromFile;
  return getOnlineLyrics(song, online);
}

/** Writes a provider's answer to the disk cache, if it can. */
async function cache(file: string, text: string): Promise<void> {
  try {
    await FileSystem.makeDirectoryAsync(LRCLIB_CACHE_DIR, { intermediates: true }).catch(() => {});
    await FileSystem.writeAsStringAsync(file, text);
  } catch {
    // Without cache we still work; it would just repeat the request.
  }
}

/**
 * Lyrics from the online providers that are on, with disk cache: lrc.red
 * first, since it matches the exact recording by ISRC and is often timed word
 * by word, then LRCLIB. Also serves as last resort for server songs whose
 * server doesn't have lyrics. Each provider caches in its own file, so turning
 * one off stops its lyrics showing.
 */
export async function getOnlineLyrics(
  song: Song,
  online: OnlineProviders,
): Promise<SongLyrics | null> {
  const key = hashKey(song.id);
  if (online.lrcRed) {
    const file = `${LRCLIB_CACHE_DIR}${key}.lrcred.ttml`;
    const cached = await readTextIfExists(file);
    const fromCache = cached ? parseTtml(cached) : null;
    if (fromCache) return fromCache;
    const text = await fetchLrcRed(song);
    const parsed = text ? parseTtml(text) : null;
    if (text && parsed) {
      await cache(file, text);
      return parsed;
    }
  }
  if (online.lrclib) {
    const file = `${LRCLIB_CACHE_DIR}${key}.lrc`;
    const cached = await readTextIfExists(file);
    if (cached) return parseLrc(cached);
    const text = await fetchLrclib(song);
    if (!text) return null;
    await cache(file, text);
    return parseLrc(text);
  }
  return null;
}

/**
 * lrc.red's TTML for the song, looked up by ISRC: a recording's own code, so
 * there is no guessing by name. A song without one (no tag, or a server that
 * does not send it) is not asked.
 */
async function fetchLrcRed(song: Song): Promise<string | null> {
  // An array in OpenSubsonic; a lone string from a server that reads it loosely.
  const codes: unknown = song.isrc;
  const isrc = (Array.isArray(codes) ? codes : typeof codes === 'string' ? [codes] : [])
    .filter((code): code is string => typeof code === 'string')
    .map((code) => code.replace(/[^A-Za-z0-9]/g, '').toUpperCase())
    .find((code) => /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(code));
  if (!isrc) {
    if (__DEV__) console.log(`[lyrics] lrc.red · not asked: no ISRC · ${song.artist} — ${song.title}`);
    return null;
  }
  // Offline chosen covers every service: see `fetchLrclib`.
  if (isManualOffline()) return null;
  try {
    const res = await fetch(`https://lrc.red/s/${isrc}.ttml`, {
      headers: { 'User-Agent': CLIENT_UA },
    });
    if (__DEV__) console.log(`[lyrics] lrc.red · ${res.status} · ${song.artist} — ${song.title}`);
    if (!res.ok) return null;
    const text = await res.text();
    return text.trim() ? text : null;
  } catch (e) {
    if (__DEV__) {
      console.log(`[lyrics] lrc.red · failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    return null;
  }
}

interface LrclibResult {
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
  instrumental?: boolean;
}

function pickLrclibText(r: LrclibResult | undefined): string | null {
  if (!r || r.instrumental) return null;
  return r.syncedLyrics?.trim() || r.plainLyrics?.trim() || null;
}

/** Searches LRCLIB for lyrics by artist+title. Returns LRC/plain text. */
/** Only in development: where a lyrics lookup went, since it never throws. */
function trace(what: string, song: Song): void {
  if (__DEV__) console.log(`[lyrics] lrclib · ${what} · ${song.artist} — ${song.title}`);
}

async function fetchLrclib(song: Song): Promise<string | null> {
  if (!song.title || !song.artist) {
    trace('not asked: the song has no artist or no title', song);
    return null;
  }
  // LRCLIB is somebody else's server, but it is reached the same way and costs
  // the same data, so an offline somebody asked for covers it too: the .lrc
  // cached next to a download is read before this is ever called.
  //
  // An offline the app fell into is a different thing. It means one server
  // stopped answering, not that the phone has no connection, and taking the
  // lyrics away too made the app look broken to whoever never noticed the
  // mode had changed.
  if (isManualOffline()) {
    trace('not asked: offline was chosen', song);
    return null;
  }
  // The User-Agent is not politeness, it is the request working at all. React
  // Native sends okhttp's own on Android, and LRCLIB answers that with a 520
  // from Cloudflare: every lookup failed, silently, on every Android phone.
  // Anything that identifies the client is accepted, and identifying it is
  // what their API asks for anyway.
  const headers = {
    'Lrclib-Client': CLIENT_UA,
    'User-Agent': CLIENT_UA,
  };
  try {
    // /api/get requires the full signature (album + duration); if we have it,
    // it's the most precise path. If not (or 404), /api/search and the first match.
    if (song.album && song.duration) {
      const params = new URLSearchParams({
        artist_name: song.artist,
        track_name: song.title,
        album_name: song.album,
        duration: String(Math.round(song.duration)),
      });
      const res = await fetch(`https://lrclib.net/api/get?${params}`, { headers });
      trace(`get ${res.status}`, song);
      if (res.ok) {
        const text = pickLrclibText((await res.json()) as LrclibResult);
        if (text) return text;
      }
    }
    const params = new URLSearchParams({ artist_name: song.artist, track_name: song.title });
    const res = await fetch(`https://lrclib.net/api/search?${params}`, { headers });
    trace(`search ${res.status}`, song);
    if (!res.ok) return null;
    const results = (await res.json()) as LrclibResult[];
    for (const r of results) {
      const text = pickLrclibText(r);
      if (text) return text;
    }
    trace(`search matched nothing (${results.length} results)`, song);
    return null;
  } catch (e) {
    // No network or the API down: simply no lyrics. Said out loud in
    // development, because a feature that fails in silence cannot be told
    // apart from one that was never asked.
    trace(`failed: ${e instanceof Error ? e.message : String(e)}`, song);
    return null;
  }
}
