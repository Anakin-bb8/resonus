/** Public artist-signature v1 contract; no music-server metadata is written. */
export const SIGNATURE_API = ''; // The listener supplies a provider; no public instance is opted in.

export interface ArtistSignature {
  imageUrl: string;
  aspect: number;
  attribution: string;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

/** The provider currently serves its own assets and Wikimedia originals. */
function assetUrl(value: unknown, api: string): string | undefined {
  if (typeof value !== 'string' || value.length > 2048) return;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) return;
    if (!['https://upload.wikimedia.org', ...(api ? [new URL(api).origin] : [])].includes(url.origin)) return;
    return url.href;
  } catch { return; }
}

export function parseArtistSignature(value: unknown, api = SIGNATURE_API): ArtistSignature | null {
  const root = record(value);
  // Ambiguous matches must never substitute somebody else's autograph.
  if (!Array.isArray(root.signatures)) return null;
  let best: ArtistSignature | null = null;
  let bestScore = -1;
  let bestArea = -1;
  for (const item of root.signatures.slice(0, 100)) {
    const signature = record(item);
    const asset = record(signature.asset);
    const imageUrl = [asset.url, signature.asset, signature.url, signature.original_url, record(signature.source).original_url]
      .map((value) => assetUrl(value, api)).find(Boolean);
    if (!imageUrl) continue;
    const license = record(signature.license);
    const source = record(signature.source);
    // Extend only with an explicit attribution policy for each additional licence.
    if (license.status !== 'known' || typeof license.name !== 'string'
      || !/^(PD-signature|CC0(?: 1\.0)?)$/i.test(license.name)) continue;
    if (typeof source.url !== 'string' || !source.url.startsWith('https://')) continue;
    const width = Number(asset.width ?? signature.width);
    const height = Number(asset.height ?? signature.height);
    const aspect = width > 0 && height > 0 && Number.isFinite(width / height) ? width / height : 2.5;
    const svg = asset.format === 'svg' || new URL(imageUrl).pathname.endsWith('.svg');
    const score = (license.status === 'known' ? 100 : 0) + (svg ? 10 : 0)
      + (signature.verification === 'artist_verified' ? 3 : signature.verification === 'verified' ? 2 : 0)
      + (aspect >= 1.4 ? 1 : 0);
    const area = Number.isFinite(width * height) && width > 0 && height > 0 ? width * height : 0;
    if (score < bestScore || (score === bestScore && area <= bestArea)) continue;
    const attribution = [source.url, license.name, license.url]
      .filter((part): part is string => typeof part === 'string').join('\n').slice(0, 4096);
    best = { imageUrl, aspect: Math.min(12, Math.max(0.5, aspect)), attribution };
    bestScore = score;
    bestArea = area;
  }
  return best;
}
