/**
 * Animated covers from an animated-artwork server (m8tec
 * apple-music-animated-artworks): given artist and album it answers the
 * square and tall HLS (`.m3u8`) clips, scraped once per album and then
 * cached server-side — so asking again is cheap, and prefetching the queue
 * ahead makes covers play the moment their track starts.
 *
 * Session cache only: the server already keeps its own, and a stale clip
 * here would outlive a corrected one there.
 *
 * The global fetch by default, so the mapping stays testable in node. The app
 * hands in `expo/fetch` (see `setAnimatedArtworkFetch`): the lock screen asks
 * for its clip on a track change, which is mostly with the app in the
 * background, and React Native's own fetch does not answer there.
 */

export interface AnimatedArtworkUrls {
  square: string;
  tall: string;
}

const cache = new Map<string, AnimatedArtworkUrls | null>();
const inflight = new Map<string, Promise<AnimatedArtworkUrls | null>>();

type Fetch = (
  url: string,
  init: { signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
let fetchImpl: Fetch = (url, init) => fetch(url, init);

/** The fetch the asks go through; the app passes `expo/fetch`. */
export function setAnimatedArtworkFetch(f: Fetch): void {
  fetchImpl = f;
}

/** A request that never got an answer: nothing learnt about the album. */
class Unanswered extends Error {}

/** When an album's ask last went unanswered, so a server that is down is not
 *  asked again for the whole look-ahead on every track change. */
const unansweredAt = new Map<string, number>();
const RETRY_AFTER_MS = 2 * 60 * 1000;

function keyOf(artist: string, album: string): string {
  return `${artist.trim().toLowerCase()}\n${album.trim().toLowerCase()}`;
}

/** The settings key a custom Apple Music URL hangs off: artist and album. */
export function animatedArtworkKey(artist: string, album: string): string {
  return keyOf(artist, album);
}

/**
 * Edition suffixes that never change the animated cover ("Play (Deluxe)"
 * moves exactly like "Play"): stripped for the retry when the full title
 * matched something else entirely.
 */
const EDITION_SUFFIX = /\s*[\[(]\s*(super\s+)?deluxe(\s+edition)?\s*[\])]\s*$|\s*-\s*(super\s+)?deluxe(\s+edition)?\s*$|\s*[\[(]\s*(remaster(ed)?|expanded|anniversary|platinum|bonus|tour|complete|legacy|definitive|collector(\u0027s|s)?|special|limited)\b[^[\]()]*[\])]\s*$/i;
/** Lowercase alphanumerics: what two titles have to share to be the same. */
function normTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(EDITION_SUFFIX, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

/** The title without its edition packaging ("Play" out of "Play (Deluxe)"). */
export function stripEditionSuffix(album: string): string {
  return album.trim().replace(EDITION_SUFFIX, '').trim();
}

/** Same album once the edition packaging is off: "Play" is "Play (Deluxe)". */
export function titlesMatch(a: string, b: string): boolean {
  const x = normTitle(a);
  const y = normTitle(b);
  return x.length > 0 && x === y;
}

function normArtist(artist: string): string {
  return artist.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

/** Same artist, tolerating case and punctuation ("ED SHEERAN" is Ed Sheeran). */
export function artistsMatch(a: string, b: string): boolean {
  const x = normArtist(a);
  const y = normArtist(b);
  return x.length > 3 && y.length > 3 && (x === y || x.includes(y) || y.includes(x));
}

interface ArtworkAnswer {
  url?: unknown;
  url_tall?: unknown;
  artist?: unknown;
  album?: unknown;
}

function pickClips(answer: ArtworkAnswer): AnimatedArtworkUrls | null {
  if (typeof answer?.url !== 'string' || typeof answer?.url_tall !== 'string') return null;
  return { square: answer.url, tall: answer.url_tall };
}

/** The answer is ours only when both names survive the normalization. */
function accepts(
  answer: ArtworkAnswer,
  artist: string,
  album: string,
): AnimatedArtworkUrls | null {
  const clips = pickClips(answer);
  if (!clips) return null;
  if (typeof answer.artist !== 'string' || !artistsMatch(answer.artist, artist)) return null;
  if (typeof answer.album !== 'string' || !titlesMatch(answer.album, album)) return null;
  return clips;
}

async function askOnce(base: string, artist: string, album: string, signal: AbortSignal) {
  const res = await fetchImpl(
    `${base}/api/v1/artwork/search?artist=${encodeURIComponent(artist.trim())}&album=${encodeURIComponent(album.trim())}`,
    { signal },
  );
  if (!res.ok) {
    // A 404 is the server saying it has nothing for this album, an answer. A
    // 5xx says nothing about the album, like no network.
    if (res.status >= 500) throw new Unanswered();
    return null;
  }
  return (await res.json()) as ArtworkAnswer;
}

/** The clips for an Apple Music URL the listener picked by hand. Trusted as
 *  chosen: no names to check it against, the choice itself was the check. */
async function askByUrl(
  base: string,
  appleUrl: string,
  signal: AbortSignal,
): Promise<AnimatedArtworkUrls | null> {
  const res = await fetchImpl(
    `${base}/api/v1/artwork/url?url=${encodeURIComponent(appleUrl.trim())}`,
    { signal },
  );
  if (!res.ok) return null;
  return pickClips((await res.json()) as ArtworkAnswer);
}

/**
 * The clips for an artist and album, or null when there are none (or no
 * endpoint). One request per album per session; concurrent asks for the same
 * album share the one already flying.
 */
export function fetchAnimatedArtwork(
  endpoint: string,
  artist: string,
  album: string,
  customUrl?: string | null,
): Promise<AnimatedArtworkUrls | null> {
  const base = endpoint.trim().replace(/\/+$/, '');
  if (!base || !artist.trim() || !album.trim()) return Promise.resolve(null);
  // A hand-picked URL answers a different question than the search: it gets
  // its own cache entry, so picking one after a search never reads stale.
  const key = `${keyOf(artist, album)}\n${customUrl?.trim() ?? ''}`;
  const hit = cache.get(key);
  if (hit !== undefined) return Promise.resolve(hit);
  const flying = inflight.get(key);
  if (flying) return flying;
  const failed = unansweredAt.get(key);
  if (failed !== undefined && Date.now() - failed < RETRY_AFTER_MS) return Promise.resolve(null);
  // Only an answer is remembered. A timeout or no network said nothing about
  // the album, and caching it as "no clip" kept the album still for the rest
  // of the session.
  let answered = true;
  const task = (async (): Promise<AnimatedArtworkUrls | null> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      // A hand-picked Apple Music URL answers the exact album: asked first
      // and trusted as chosen.
      if (customUrl?.trim()) {
        const chosen = await askByUrl(base, customUrl, controller.signal);
        if (chosen) return chosen;
      }
      const first = await askOnce(base, artist, album, controller.signal);
      // The server matches fuzzily and sometimes matches wrong ("Play
      // (Deluxe)" answering another album): a wrong answer is dropped, never
      // shown. Without its edition packaging the same album usually answers
      // right — and shares the animated cover anyway.
      const accepted = first && accepts(first, artist, album);
      if (accepted) return accepted;
      const stripped = stripEditionSuffix(album);
      if (stripped && stripped.toLowerCase() !== album.trim().toLowerCase()) {
        const second = await askOnce(base, artist, stripped, controller.signal);
        if (second) {
          const retry = accepts(second, artist, stripped);
          if (retry) return retry;
        }
      }
      return null;
    } catch {
      answered = false;
      return null;
    } finally {
      clearTimeout(timeout);
    }
  })().then((out) => {
    if (answered) {
      cache.set(key, out);
      unansweredAt.delete(key);
    } else {
      unansweredAt.set(key, Date.now());
    }
    inflight.delete(key);
    return out;
  });
  inflight.set(key, task);
  return task;
}

/** Warms the cache for a song without waiting: the queue ahead asks this way. */
export function prefetchAnimatedArtwork(
  endpoint: string,
  song: { artist?: string; album?: string } | null | undefined,
  customUrl?: string | null,
): void {
  if (!endpoint || !song?.artist || !song?.album) return;
  void fetchAnimatedArtwork(endpoint, song.artist, song.album, customUrl);
}
