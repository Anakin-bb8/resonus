/**
 * Podcasts, subscribed to on the phone and read from their own feeds.
 *
 * Navidrome answers the Subsonic podcast endpoints with 501, and Jellyfin and
 * Ampache have none, so no server is asked. Subscriptions are filed per
 * profile (`profileScopeId()`) and `lib/profileData.ts` deletes them with it.
 * An episode plays as a `Song` whose `url` is the enclosure, like radio.
 */
import { fetch } from 'expo/fetch';

import { profileScopeId } from '@/store/auth';

import { hashKey } from '@/lib/localLibrary';
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

/** The only third-party host involved; a pasted feed URL needs nothing. */
const ITUNES_SEARCH = 'https://itunes.apple.com/search';

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
 * Reads one feed and stores it, episodes replaced by what it lists now.
 *
 * A new subscription is only kept once its feed has been read. An existing one
 * that fails stays, with the error on its channel row, so it can still be seen
 * and cancelled.
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
      error: e instanceof Error ? e.message : String(e),
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
  return channel;
}

/** Subscribes to a feed, given its address or the show's page. */
export async function subscribe(input: string): Promise<PodcastChannel> {
  return refreshChannel(input);
}

/** Unsubscribes: the channel, its episodes and its feed. */
export async function unsubscribe(id: string): Promise<void> {
  await Db.removeChannel(scope(), id);
}

/** Every subscribed channel, most recently published first. */
export async function listChannels(): Promise<PodcastChannel[]> {
  return Db.listChannels(scope());
}

export async function getChannel(id: string): Promise<PodcastChannel | undefined> {
  return Db.getChannel(scope(), id);
}

export async function listEpisodes(channelId: string): Promise<PodcastEpisode[]> {
  return Db.listEpisodes(scope(), channelId);
}

/** The newest playable episodes across every subscription, for Home. */
export async function listRecentEpisodes(limit = 20): Promise<RecentEpisode[]> {
  return Db.listRecentEpisodes(scope(), limit);
}

/**
 * Reads every subscription again, one at a time so no host sees a burst.
 * Failures are counted, not thrown: one dead feed must not stall the rest.
 */
export async function refreshAll(): Promise<{ failed: number; total: number }> {
  const s = scope();
  const feeds = await Db.listFeeds(s);
  let failed = 0;
  for (const feed of feeds) {
    try {
      await refreshChannel(feed);
    } catch {
      failed++;
    }
  }
  return { failed, total: feeds.length };
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
    artist: channel.title,
    album: channel.title,
    url: episode.url,
    // A file, not a station: it can play at another speed.
    vod: true,
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
    throw new Error('search');
  }
  const out: PodcastSearchResult[] = [];
  const seen = new Set<string>();
  for (const r of parsed.results ?? []) {
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
