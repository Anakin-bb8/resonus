/**
 * Priority heuristic across a profile's candidate URLs. When probing which
 * one to use (see `store/autoUrl.ts`) we try local network ones first: at
 * home the local IP wins (fast, no internet roundtrip) and, when it stops
 * responding, it automatically falls back to the remote one (domain,
 * Tailscale...). This way the user doesn't have to order anything manually.
 */

import type { SubsonicAuth } from '@/api/subsonic';

/**
 * The profile's identity (see `scopeUrl`). `serverUrl` is the ACTIVE URL and
 * changes when switching networks; for per-profile storage keys (queue,
 * downloads, history...) you must use this one, not the active one, or
 * they'd split. It is an address, but not necessarily one the profile still
 * uses: an edited address leaves its name behind so that what was filed under
 * it stays found.
 */
export function primaryUrl(auth: Pick<SubsonicAuth, 'urls' | 'serverUrl' | 'scopeUrl'>): string {
  return auth.scopeUrl ?? auth.urls?.[0] ?? auth.serverUrl;
}

function hostOf(url: string): string | null {
  const m = url.match(/^https?:\/\/([^/:]+)/i);
  return m ? m[1].toLowerCase() : null;
}

/** Does the URL point to a local network (LAN) address? */
export function isLanUrl(url: string): boolean {
  const host = hostOf(url);
  if (!host) return false;
  if (host === 'localhost' || host.endsWith('.local')) return true;
  // RFC 1918 private ranges + loopback. Note: Tailscale (100.64.0.0/10)
  // does NOT count as LAN on purpose: it's reachable over mobile data too,
  // so it must go AFTER the real LAN so at home the local one is preferred.
  return (
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  );
}

/**
 * Copy sorted by probe priority: LAN first, preserving relative order
 * within each group (Array.sort is stable). Does not mutate the input;
 * the stored profile order remains insertion order.
 */
export function byProbePriority(urls: string[]): string[] {
  return [...urls].sort((a, b) => Number(isLanUrl(b)) - Number(isLanUrl(a)));
}
