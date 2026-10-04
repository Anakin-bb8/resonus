/**
 * What the scrobble services have heard of you: artist weights, merged across
 * Last.fm and ListenBrainz, for the radios on Home.
 *
 * Both are read-only and entirely optional (Settings › Scrobbling): a missing
 * key, a wrong username or no network at all each cost that service its votes
 * and nothing else — the radios then come from the server's own play counts,
 * which is all a local profile or a server without scrobbling has.
 */
import { useAuthStore } from '@/store/auth';
import { useSettings } from '@/store/settings';

/** Lowercased artist name → plays in the window asked for. */
export type ArtistWeights = Map<string, number>;

/** Plays each service is asked for: a recent window, not a whole life's
 *  scrobbles — the radio is about what is being played now. */
const WINDOW = 200;

/** A scrobble server that doesn't answer shouldn't hold the radios hostage. */
const TIMEOUT_MS = 8000;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function add(weights: ArtistWeights, name: string | null): void {
  const key = name?.trim().toLowerCase();
  if (!key) return;
  weights.set(key, (weights.get(key) ?? 0) + 1);
}

/** `user.getRecentTracks`: newest first, with the now-playing entry skipped
 *  (it has a position and no play behind it). */
async function lastfmWeights(user: string, apiKey: string, weights: ArtistWeights): Promise<void> {
  const url =
    'https://ws.audioscrobbler.com/2.0/?method=user.getRecentTracks' +
    `&user=${encodeURIComponent(user)}&api_key=${encodeURIComponent(apiKey)}` +
    `&limit=${WINDOW}&format=json`;
  const json = asRecord(await fetchJson(url));
  const tracks = json?.recenttracks;
  const list = asRecord(tracks)?.track;
  if (!Array.isArray(list)) return;
  for (const entry of list) {
    const track = asRecord(entry);
    if (!track) continue;
    const attr = asRecord(track['@attr']);
    if (attr && asString(attr.nowplaying) === 'true') continue;
    add(weights, asString(asRecord(track.artist)?.['#text']));
  }
}

/** `GET /1/user/{user}/listens`: `count` of the most recent ones. */
async function listenBrainzWeights(user: string, weights: ArtistWeights): Promise<void> {
  const url =
    `https://api.listenbrainz.org/1/user/${encodeURIComponent(user)}/listens` +
    `?count=${WINDOW}`;
  const json = asRecord(await fetchJson(url));
  const listens = json?.listens;
  if (!Array.isArray(listens)) return;
  for (const entry of listens) {
    const meta = asRecord(asRecord(entry)?.track_metadata);
    add(weights, asString(meta?.artist_name));
  }
}

/**
 * Artist plays from both services, summed by name (services key on names,
 * not ids, and spellings are the same ones people scrobble with everywhere).
 *
 * Empty when nothing is configured, when offline, or when every request
 * failed: the caller falls back to the server's own play counts.
 */
export async function recentArtistWeights(): Promise<ArtistWeights> {
  const weights: ArtistWeights = new Map();
  if (useAuthStore.getState().offline) return weights;
  const { lastfmUser, lastfmApiKey, listenbrainzUser } = useSettings.getState();
  const jobs: Promise<void>[] = [];
  if (lastfmUser && lastfmApiKey) jobs.push(lastfmWeights(lastfmUser, lastfmApiKey, weights));
  if (listenbrainzUser) jobs.push(listenBrainzWeights(listenbrainzUser, weights));
  // Each service already fails into nothing; the two races only merge into the
  // same map from one thread each.
  await Promise.all(jobs);
  return weights;
}
