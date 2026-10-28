import { fetch } from 'expo/fetch';
import * as FileSystem from 'expo-file-system/legacy';
import { Image } from 'expo-image';

import { isManualOffline } from '@/api/netGate';
import { parseArtistSignature, SIGNATURE_API, type ArtistSignature } from './artistSignatures';
import { hashKey } from './localLibrary';
import { publicHttpsUrl } from './artworkSources';

const CACHE_DIR = `${FileSystem.documentDirectory}artist-signatures/`;
const TTL = 7 * 24 * 60 * 60 * 1000;
const MISS_TTL = 5 * 60 * 1000;

/** Public name only, never server credentials, artist IDs or Navidrome writes. */
export async function getArtistSignature(name: string, api = SIGNATURE_API): Promise<ArtistSignature | null> {
  const source = publicHttpsUrl(api);
  if (!source) return null;
  const normalized = name.trim().normalize('NFC');
  if (!normalized || normalized.length > 300) return null;
  const key = `${source}\n${normalized}`;
  const file = `${CACHE_DIR}${hashKey(key)}.json`;
  let cached: { signature: ArtistSignature | null; at: number } | undefined;
  try {
    const saved = JSON.parse(await FileSystem.readAsStringAsync(file));
    // Keep the exact requested name alongside the hash to reject collisions.
    if (saved.version === 3 && saved.key === key && Number.isFinite(saved.at)) {
      cached = { signature: parseArtistSignature(saved.response, source), at: saved.at };
    }
  } catch { /* A cache miss never prevents the normal artist header. */ }
  if (isManualOffline()) {
    const signature = cached?.signature;
    if (!signature) return null;
    const path = await Image.getCachePathAsync(signature.imageUrl).catch(() => null);
    return path ? { ...signature, imageUrl: `file://${path.replace(/^file:\/\//, '')}` } : null;
  }
  if (cached && Date.now() - cached.at < (cached.signature ? TTL : MISS_TTL)) return cached.signature;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const endpoint = new URL(source);
    if (!endpoint.pathname.replace(/\/$/, '').endsWith('/v1/signatures')) endpoint.pathname = endpoint.pathname.replace(/\/$/, '') + '/v1/signatures';
    endpoint.searchParams.set('artist', normalized);
    const response = await fetch(endpoint.href, {
      signal: controller.signal,
    });
    let body: unknown = { signatures: [] };
    if (response.status !== 404) {
      if (!response.ok) throw new Error(`Signature HTTP ${response.status}`);
      const text = await response.text();
      if (text.length > 512_000) throw new Error('Signature response too large');
      body = JSON.parse(text);
    }
    const signature = parseArtistSignature(body, source);
    if (!signature && cached?.signature) return cached.signature;
    try {
      await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
      await FileSystem.writeAsStringAsync(file, JSON.stringify({ version: 3, key, at: Date.now(), response: body }));
    } catch { /* Optional cache; successful requests still display normally. */ }
    return signature;
  } catch {
    if (__DEV__) console.debug('[artist-signature] lookup unavailable; using cached artwork or name');
    return cached?.signature ?? null;
  } finally {
    clearTimeout(timer);
  }
}
