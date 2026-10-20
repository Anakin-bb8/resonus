/**
 * Podcasts, kept on the phone and read from their own feeds.
 *
 * Navidrome answers the Subsonic podcast endpoints with 501, and Jellyfin and
 * Ampache have none, so no server is asked. Subscriptions are filed per
 * profile (`profileScopeId()`) and `lib/profileData.ts` deletes them with it.
 * An episode plays as a `Song` whose `url` is the enclosure, like radio.
 */
import { fetch } from 'expo/fetch';

import { assertCanRequest, isManualOffline, OfflineError } from './netGate';
import { profileScopeId } from '@/store/auth';

import { hashKey } from '@/lib/localLibrary';
import { invalidatePodcastFavorites } from '@/lib/query';
import * as Db from '@/lib/podcastDb';
import type { RecentEpisode } from '@/lib/podcastDb';
import { parseFeed, sortEpisodes, type ParsedItem } from '@/lib/podcastFeed';
import type { PodcastChannel, PodcastEpisode, Song } from './subsonic';

export type { PodcastChannel, PodcastEpisode } from './subsonic';
export type { RecentEpisode } from '@/lib/podcastDb';

/** A URL that answers, but not with a feed. */
class NotAFeedError extends Error {}

/** A feed that could not be reached at all. */
class FeedUnreachableError extends Error {}

/**
 * Why a feed read failed, as a stable code rather than a message. It is what
 * gets filed on the channel row, so the reason survives to be read back offline,
 * and so the surfaces that show it can split "you're offline" from "the feed
 * itself was bad" without sniffing at somebody's error text.
 */
export function feedErrorCode(e: unknown): 'offline' | 'notFeed' | 'http' {
  if (e instanceof OfflineError) return 'offline';
  if (e instanceof NotAFeedError) return 'notFeed';
  return 'http';
}

/** The iTunes directory: search returns each show's feed URL. */
const ITUNES_SEARCH = 'https://itunes.apple.com/search';

/** Same store, looked up by id: the charts give ids, this turns them into feeds. */
const ITUNES_LOOKUP = 'https://itunes.apple.com/lookup';

/** The iTunes Store's own top-podcasts chart; a starting point for discovery. */
const ITUNES_CHARTS = 'https://itunes.apple.com/us/rss/toppodcasts/limit=100/json';

/** Wide on purpose: a pasted address is often the show's HTML page. */
const FEED_ACCEPT = 'application/rss+xml, application/atom+xml, text/xml, */*';

export interface PodcastSearchResult {
  feedUrl: string;
  title: string;
  author?: string;
  imageUrl?: string;
  siteUrl?: string;
}

const TIMEOUT_MS = 20_000;

function scope(): string {
  return hashKey(profileScopeId());
}

async function get(url: string, accept: string): Promise<string> {
  // Podcast hosts are nobody's server: the publisher's feed and the iTunes
  // directory are as reachable when the app fell offline because the server
  // stopped answering as when it did not. Only a manual "use no network" says
  // no — the same split `netGate` draws for LRCLIB.
  assertCanRequest(!isManualOffline());
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { accept, 'user-agent': 'Resonus' },
      signal: ctl.signal,
    });
    if (!res.ok) throw new FeedUnreachableError(String(res.status));
    return await res.text();
  } catch (e) {
    if (e instanceof NotAFeedError || e instanceof FeedUnreachableError) throw e;
    throw new FeedUnreachableError(e instanceof Error ? e.message : String(e));
  } finally {
    clearTimeout(timer);
  }
}

/** The scheme is left alone: some feeds only work over http. */
function feedId(feedUrl: string): string {
  return hashKey(feedUrl.trim());
}

function normalized(feedUrl: string): string {
  const trimmed = feedUrl.trim();
  if (!trimmed) throw new NotAFeedError('empty');
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/**
 * The feed at a URL: the URL itself, or the `rel="alternate"` RSS/Atom link
 * of the page it points at. Capped at two hops so pages linking pages end.
 */
async function resolveFeed(url: string, body: string, hops = 0): Promise<string> {
  if (looksLikeFeed(body)) return url;
  if (hops >= 2) throw new NotAFeedError(url);

  for (const m of body.matchAll(/<link\b([^>]*)>/gi)) {
    const attrs = m[1];
    const type = attrs.match(/type\s*=\s*["']?([^"'\s>]+)/i)?.[1] ?? '';
    if (!/rss|atom|xml/i.test(type)) continue;
    if (!/(^|\s)rel\s*=\s*["']?alternate/i.test(attrs)) continue;
    const href = attrs.match(/href\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    const next = new URL(href, url).toString();
    return resolveFeed(next, await get(next, FEED_ACCEPT), hops + 1);
  }

  throw new NotAFeedError(url);
}

function looksLikeFeed(body: string): boolean {
  return /<(rss|feed|channel)\b/i.test(body);
}

function toEpisode(channelId: string, item: ParsedItem): PodcastEpisode {
  const episode: PodcastEpisode = { id: item.id, channelId, title: item.title };
  if (item.description) episode.description = item.description;
  if (item.publishedAt !== undefined) episode.publishedAt = item.publishedAt;
  if (item.duration !== undefined) episode.duration = item.duration;
  if (item.url) episode.url = item.url;
  if (item.mimeType) episode.mimeType = item.mimeType;
  if (item.size !== undefined) episode.size = item.size;
  if (item.imageUrl) episode.imageUrl = item.imageUrl;
  return episode;
}

/**
 * Reads one feed and stores it, episodes replaced by what it lists now. This is
 * how a show is opened: the first read files it in SQLite, a later read only
 * updates it. There is no subscribe — opening a show lands it.
 *
 * A new show is only kept once its feed has been read. An existing one that
 * fails stays, with the error on its channel row, so it can still be seen and
 * removed.
 */
export async function refreshChannel(input: string): Promise<PodcastChannel> {
  const url = normalized(input);
  const s = scope();

  let body: string;
  let resolved = url;
  try {
    body = await get(url, FEED_ACCEPT);
    resolved = await resolveFeed(url, body);
    // The feed found is what gets stored, so the next refresh skips the page.
    if (resolved !== url) body = await get(resolved, FEED_ACCEPT);
  } catch (e) {
    // Keyed by the stored feed, or a refresh would file the show twice.
    const existing = await Db.getChannel(s, feedId(resolved));
    if (!existing) throw e;
    await Db.saveChannel(s, {
      ...existing,
      feedUrl: resolved,
      error: feedErrorCode(e),
      refreshedAt: Date.now(),
    });
    throw e;
  }

  const id = feedId(resolved);
  const existing = await Db.getChannel(s, id);
  const feed = parseFeed(body, id);
  const episodes = sortEpisodes(feed.items).map((item) => toEpisode(id, item));
  const dates = episodes
    .map((e) => e.publishedAt)
    .filter((d): d is number => d !== undefined);

  const channel: PodcastChannel = {
    id,
    title: feed.title?.trim() || existing?.title || url,
    feedUrl: resolved,
    refreshedAt: Date.now(),
    episodeCount: episodes.length,
    lastPublishedAt: dates.length > 0 ? Math.max(...dates) : existing?.lastPublishedAt,
  };
  if (feed.description) channel.description = feed.description;
  if (feed.author) channel.author = feed.author;
  if (feed.imageUrl) channel.imageUrl = feed.imageUrl;
  if (feed.siteUrl) channel.siteUrl = feed.siteUrl;

  await Db.saveChannel(s, channel);
  await Db.replaceEpisodes(s, id, episodes);
  await Db.addFeed(s, resolved);
  // The picture belongs to the read that just happened: filing it here is
  // what keeps a kept show's art drawable when manual offline says no to
  // fetching and expo-image's cache has evicted the address.
  if (channel.imageUrl) void Db.savePodcastArt(s, channel.id, channel.imageUrl).catch(() => {});
  return channel;
}

/** The show's picture: the file on the phone if it is there, the feed's
 *  address if not. */
export function podcastCover(
  channelId: string,
  imageUrl: string | undefined,
): string | undefined {
  return imageUrl ? Db.localPodcastArt(scope(), channelId, imageUrl) ?? imageUrl : undefined;
}

/** The stored channel by its feed address, before it is opened. */
export async function getStoredChannel(feedUrl: string): Promise<PodcastChannel | undefined> {
  return Db.getChannel(scope(), feedId(feedUrl));
}

export async function getChannel(id: string): Promise<PodcastChannel | undefined> {
  return Db.getChannel(scope(), id);
}

/** Every channel kept on the device, most recently published first. */
export async function listChannels(): Promise<PodcastChannel[]> {
  return Db.listChannels(scope());
}

/** The episodes of a channel, newest first, one page at a time. */
export async function listEpisodes(channelId: string): Promise<PodcastEpisode[]> {
  return Db.listEpisodes(scope(), channelId);
}

/** The route id is either a stored channel id or a percent-encoded feed URL. */
export function isFeedUrl(id: string): boolean {
  return /^https?:\/\//i.test(decodeURIComponent(id));
}

/** Every episode of a channel, pages read to the end. */
export async function listAllEpisodes(channelId: string): Promise<PodcastEpisode[]> {
  return Db.listAllEpisodes(scope(), channelId);
}

/** How many of a show's episodes are downloaded, and their ids. */
export async function downloadedForChannel(
  channelId: string,
): Promise<{ ids: string[]; count: number }> {
  return Db.downloadedForChannel(scope(), channelId);
}

/** The newest playable episodes across every show you keep, for Home. */
export async function listRecentEpisodes(limit = 20): Promise<RecentEpisode[]> {
  return Db.listRecentEpisodes(scope(), limit);
}

/** Hearts. The user's own, kept on the device like the shows themselves. */
/** The heart's one entry point: a show (`channel`) or one of its episodes. */
export async function toggleFavoritePodcast(
  id: string,
  kind: 'channel' | 'episode',
  channelId: string,
): Promise<boolean> {
  return Db.toggleFavorite(scope(), id, kind, channelId);
}

/** The heart's one entry point for callers that show hearts: the SQLite row
 *  and the cache answer together, so no surface can forget the pairing. */
export async function togglePodcastHeart(
  id: string,
  kind: 'channel' | 'episode',
  channelId: string,
): Promise<boolean> {
  const added = await toggleFavoritePodcast(id, kind, channelId);
  invalidatePodcastFavorites();
  return added;
}

/** The one answer to a feed that would not load: offline says so,
 *  otherwise it is the publisher's side. One message, one locale key. */
export function feedErrorMessage(translate: (key: string) => string, e: unknown): string {
  return feedErrorCode(e) === 'offline'
    ? translate("You're offline")
    : translate("Couldn't read this feed");
}

/** The hearted ids, so a row can light its heart without asking per row. */
export async function favoriteIds(): Promise<Set<string>> {
  return Db.favoriteIds(scope());
}

/** Stand-in for a heart set that hasn't loaded yet. One instance, so a row's
 * `favSet` prop keeps its identity across renders instead of churning. */
export const NO_FAVORITES: Set<string> = new Set();

export async function listFavoriteChannels(): Promise<PodcastChannel[]> {
  return Db.listFavoriteChannels(scope());
}

export async function listFavoriteEpisodes(limit = 100): Promise<RecentEpisode[]> {
  return Db.listFavoriteEpisodes(scope(), limit);
}

/**
 * Reads every show you keep again, one at a time so no host sees a burst.
 * Failures are counted, not thrown: one dead feed must not stall the rest.
 * `shouldCancel` is checked before each feed, so a Stop part way through
 * leaves the feeds already read in place and returns without touching the rest.
 */
export async function refreshAll(
  shouldCancel?: () => boolean,
): Promise<{ failed: number; total: number; stopped: boolean }> {
  const s = scope();
  const feeds = await Db.listFeeds(s);
  let failed = 0;
  for (const feed of feeds) {
    if (shouldCancel?.()) return { failed, total: feeds.length, stopped: true };
    try {
      await refreshChannel(feed);
    } catch {
      failed++;
    }
  }
  return { failed, total: feeds.length, stopped: false };
}

const SUFFIXES: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
};

/** An episode as a queue entry; `coverArtUrl` passes the artwork URL through. */
export function episodeToSong(episode: PodcastEpisode, channel: PodcastChannel): Song {
  const song: Song = {
    id: episode.id,
    title: episode.title,
    // The show stands in for both, so an episode reads like a track off a record
    // named after the show. Nothing navigates these as a real artist/album: every
    // consumer (rows, player, the song menu) gates on `podcastChannelId` first, and
    // the album/artist nav and "More from artist" are unreachable from an episode.
    artist: channel.title,
    album: channel.title,
    url: episode.url,
    // A file, not a station: it can play at another speed.
    vod: true,
    // The show it belongs to: the episode's menu offers "Go to Podcast".
    podcastChannelId: channel.id,
  };
  if (channel.imageUrl) song.coverArt = channel.imageUrl;
  if (episode.duration !== undefined) song.duration = episode.duration;
  if (episode.publishedAt !== undefined) song.addedAt = episode.publishedAt;
  const suffix = episode.mimeType ? SUFFIXES[episode.mimeType.toLowerCase()] : undefined;
  if (suffix) song.suffix = suffix;
  return song;
}

/** Searches the iTunes directory, which returns each show's feed URL. */
export async function search(term: string): Promise<PodcastSearchResult[]> {
  const q = term.trim();
  if (!q) return [];
  const url = `${ITUNES_SEARCH}?media=podcast&entity=podcast&limit=25&term=${encodeURIComponent(q)}`;
  const body = await get(url, 'application/json');
  let parsed: {
    results?: {
      feedUrl?: string;
      collectionName?: string;
      artistName?: string;
      artworkUrl100?: string;
      collectionViewUrl?: string;
    }[];
  };
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error('iTunes search returned no JSON');
  }
  const out = iTunesResults(parsed.results ?? []);
  return out;
}

/**
 * iTunes search/lookup rows as search results. Both endpoints answer with the
 * same fields; a show with no `feedUrl` cannot be added, so it is left
 * out, and the same feed twice (search lists a show more than once) is kept once.
 */
interface iTunesRow {
  feedUrl?: string;
  collectionName?: string;
  artistName?: string;
  artworkUrl100?: string;
  collectionViewUrl?: string;
}

function iTunesResults(results: iTunesRow[]): PodcastSearchResult[] {
  const out: PodcastSearchResult[] = [];
  const seen = new Set<string>();
  for (const r of results) {
    if (!r.feedUrl || seen.has(r.feedUrl)) continue;
    seen.add(r.feedUrl);
    const result: PodcastSearchResult = {
      feedUrl: r.feedUrl,
      title: r.collectionName?.trim() || r.feedUrl,
    };
    if (r.artistName) result.author = r.artistName;
    if (r.artworkUrl100) result.imageUrl = r.artworkUrl100;
    if (r.collectionViewUrl) result.siteUrl = r.collectionViewUrl;
    out.push(result);
  }
  return out;
}

/**
 * Discovery: the iTunes Store's top-podcasts chart, as addable shows.
 *
 * The chart lists each show's store id, not its feed, so the ids go to the
 * lookup endpoint to get the feed back.
 */
export async function charts(limit = 25): Promise<PodcastSearchResult[]> {
  const body = await get(ITUNES_CHARTS, 'application/json');
  let parsed: {
    feed?: {
      entry?: {
        id?: { attributes?: { 'im:id'?: string } };
      }[];
    };
  };
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error('iTunes charts returned no JSON');
  }
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const e of parsed.feed?.entry ?? []) {
    const id = e.id?.attributes?.['im:id'];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= limit) break;
  }
  if (ids.length === 0) return [];
  const lookupBody = await get(
    `${ITUNES_LOOKUP}?id=${ids.join(',')}&entity=podcast`,
    'application/json',
  );
  let lk: { results?: iTunesRow[] };
  try {
    lk = JSON.parse(lookupBody);
  } catch {
    throw new Error('iTunes lookup returned no JSON');
  }
  return iTunesResults(lk.results ?? []);
}
