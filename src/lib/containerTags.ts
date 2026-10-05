/**
 * Tags that are not ID3: MP4's (`.m4a`, `.alac`) and FLAC's (#249).
 *
 * The local scan only knew ID3, so every M4A and FLAC came in titled after its
 * file and filed under Unknown artist. Both formats keep their tags somewhere
 * of their own, and both are read here into the same `ID3Tags` the rest of the
 * scan already understands, including `cutFrame: 'APIC'` for a cover that was
 * left out on purpose, which is what sends the scan's second pass back for it.
 *
 * The parsing is pure and works on bytes; walking the file to find those bytes
 * is the caller's (see `readTags` in localLibrary.ts), which is what lets a
 * cover be skipped without being read.
 */
import { uint8ToBase64, type ID3Tags } from './id3';

const utf8 = new TextDecoder('utf-8');

function u32BE(b: Uint8Array, at: number): number {
  return ((b[at] << 24) >>> 0) + ((b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]);
}

function u32LE(b: Uint8Array, at: number): number {
  return ((b[at + 3] << 24) >>> 0) + ((b[at + 2] << 16) | (b[at + 1] << 8) | b[at]);
}

function fourCC(b: Uint8Array, at: number): string {
  return String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);
}

function yearOf(text: string): number | undefined {
  const year = parseInt(text.trim().slice(0, 4), 10);
  return Number.isFinite(year) && year > 0 ? year : undefined;
}

function advisory(value: number): string | undefined {
  // iTunes: 1 (and the older 4) explicit, 2 clean, 0 nothing said.
  if (value === 1 || value === 4) return 'explicit';
  if (value === 2) return 'clean';
  return undefined;
}

// ── MP4 ──────────────────────────────────────────────────────────────────────

/** An `ftyp` box first is what an MP4 file starts with. */
export function isMp4(head: Uint8Array): boolean {
  return head.length >= 8 && fourCC(head, 4) === 'ftyp';
}

/**
 * The items of an `ilst` box (moov › udta › meta › ilst), given its content.
 *
 * Each item is a box named after the tag (`©nam`, `©ART`…) holding a `data`
 * box: four bytes of type, four of locale, then the value. `covr` is skipped
 * when `withCover` is false and only noted as being there.
 */
export function parseIlst(ilst: Uint8Array, withCover: boolean): ID3Tags {
  const tags: ID3Tags = {};
  let at = 0;
  while (at + 8 <= ilst.length) {
    const size = u32BE(ilst, at);
    if (size < 8 || at + size > ilst.length) break;
    const name = fourCC(ilst, at + 4);
    const end = at + size;
    // The first `data` box inside the item; `----` freeform items put a `mean`
    // and a `name` ahead of it.
    let d = at + 8;
    let value: Uint8Array | null = null;
    let type = -1;
    let freeformName: string | undefined;
    while (d + 8 <= end) {
      const dSize = u32BE(ilst, d);
      if (dSize < 8 || d + dSize > end) break;
      const dName = fourCC(ilst, d + 4);
      if (dName === 'name' && dSize > 12) freeformName = utf8.decode(ilst.subarray(d + 12, d + dSize));
      if (dName === 'data' && dSize >= 16) {
        type = u32BE(ilst, d + 8) & 0xffffff;
        value = ilst.subarray(d + 16, d + dSize);
        break;
      }
      d += dSize;
    }
    if (value) {
      const text = () => utf8.decode(value!).replace(/\0+$/, '').trim() || undefined;
      switch (name) {
        case '©nam':
          tags.title = text();
          break;
        case '©ART':
          tags.artist = text();
          break;
        case 'aART':
          tags.albumArtist = text();
          break;
        case '©alb':
          tags.album = text();
          break;
        case '©day':
          tags.year = yearOf(text() ?? '');
          break;
        case 'trkn':
          // Two reserved bytes, then the track and the total, 16 bits each.
          if (value.length >= 4) tags.track = ((value[2] << 8) | value[3]) || undefined;
          break;
        case '©lyr':
          tags.lyrics = text();
          break;
        case '©cmt':
          tags.comment = text();
          break;
        case 'rtng':
          if (value.length >= 1) tags.explicitStatus = advisory(value[0]);
          break;
        case '----':
          if (freeformName === 'ITUNESADVISORY') tags.explicitStatus = advisory(parseInt(text() ?? '', 10));
          break;
        case 'covr':
          if (!withCover) {
            tags.cutFrame = 'APIC';
          } else if (!tags.coverBase64 && value.length > 0) {
            // 13 JPEG, 14 PNG; anything else is left to the bytes to say.
            tags.coverMime = type === 14 || (value[0] === 0x89 && value[1] === 0x50) ? 'image/png' : 'image/jpeg';
            tags.coverBase64 = uint8ToBase64(value);
          }
          break;
      }
    }
    at = end;
  }
  return tags;
}

// ── FLAC ─────────────────────────────────────────────────────────────────────

export function isFlac(head: Uint8Array): boolean {
  return head.length >= 4 && fourCC(head, 0) === 'fLaC';
}

export const FLAC_VORBIS_COMMENT = 4;
export const FLAC_PICTURE = 6;

/** A VORBIS_COMMENT block (little-endian, unlike the rest of FLAC) into tags. */
export function parseVorbisComment(block: Uint8Array, tags: ID3Tags = {}): ID3Tags {
  let at = 0;
  if (block.length < 8) return tags;
  at += 4 + u32LE(block, 0); // vendor string
  if (at + 4 > block.length) return tags;
  const count = u32LE(block, at);
  at += 4;
  for (let i = 0; i < count && at + 4 <= block.length; i++) {
    const len = u32LE(block, at);
    at += 4;
    if (at + len > block.length) break;
    const entry = utf8.decode(block.subarray(at, at + len));
    at += len;
    const eq = entry.indexOf('=');
    if (eq <= 0) continue;
    const key = entry.slice(0, eq).toUpperCase();
    const value = entry.slice(eq + 1).trim();
    if (!value) continue;
    // The first of a repeated field wins, as a single-valued tag elsewhere.
    switch (key) {
      case 'TITLE':
        tags.title ??= value;
        break;
      case 'ARTIST':
        tags.artist ??= value;
        break;
      case 'ALBUMARTIST':
      case 'ALBUM ARTIST':
      case 'ALBUM_ARTIST':
        tags.albumArtist ??= value;
        break;
      case 'ALBUM':
        tags.album ??= value;
        break;
      case 'TRACKNUMBER':
        tags.track ??= parseInt(value, 10) || undefined;
        break;
      case 'DATE':
      case 'YEAR':
      case 'ORIGINALDATE':
        tags.year ??= yearOf(value);
        break;
      case 'LYRICS':
      case 'UNSYNCEDLYRICS':
        tags.lyrics ??= value;
        break;
      case 'COMMENT':
      case 'DESCRIPTION':
        tags.comment ??= value;
        break;
      case 'ITUNESADVISORY':
        tags.explicitStatus ??= advisory(parseInt(value, 10));
        break;
    }
  }
  return tags;
}

/** A PICTURE block (big-endian) onto `tags`, if it is the front cover or the first. */
export function parseFlacPicture(block: Uint8Array, tags: ID3Tags): void {
  if (block.length < 32) return;
  const pictureType = u32BE(block, 0);
  if (tags.coverBase64 && pictureType !== 3) return;
  let at = 4;
  const mimeLen = u32BE(block, at);
  at += 4;
  const mime = utf8.decode(block.subarray(at, at + mimeLen));
  at += mimeLen;
  at += 4 + u32BE(block, at); // description
  at += 16; // width, height, depth, colours
  if (at + 4 > block.length) return;
  const len = u32BE(block, at);
  at += 4;
  if (len === 0 || at + len > block.length) return;
  tags.coverMime = mime || 'image/jpeg';
  tags.coverBase64 = uint8ToBase64(block.subarray(at, at + len));
}

// ── Finding the bytes ────────────────────────────────────────────────────────

/** Reads `length` bytes at `position`; fewer (or none) at the end of the file. */
export type ByteReader = (position: number, length: number) => Promise<Uint8Array>;

/** Boxes looked at before giving up on a level: a guard, not a limit. */
const MAX_HOPS = 64;
/** A Vorbis comment block holding more than this is lyrics; the rest is enough. */
const MAX_COMMENT_BYTES = 1_000_000;

interface Box {
  at: number;
  /** Infinity for a box that runs to the end of the file. */
  size: number;
  header: number;
}

async function findBox(read: ByteReader, start: number, end: number, type: string): Promise<Box | null> {
  let at = start;
  for (let hops = 0; at + 8 <= end && hops < MAX_HOPS; hops++) {
    const h = await read(at, 16);
    if (h.length < 8) return null;
    let size = u32BE(h, 0);
    let header = 8;
    if (size === 1) {
      if (h.length < 16) return null;
      size = u32BE(h, 8) * 2 ** 32 + u32BE(h, 12);
      header = 16;
    } else if (size === 0) {
      size = Infinity;
    }
    if (size < header) return null;
    if (fourCC(h, 4) === type) return { at, size, header };
    if (!Number.isFinite(size)) return null;
    at += size;
  }
  return null;
}

/**
 * An MP4 file's iTunes tags. The `moov` box is often at the end, behind the
 * audio, so the walk hops from box header to box header rather than reading
 * its way there.
 */
export async function readMp4Tags(read: ByteReader, withCover: boolean, maxBytes: number): Promise<ID3Tags> {
  const tags: ID3Tags = {};
  const moov = await findBox(read, 0, Infinity, 'moov');
  if (!moov) return tags;
  const moovEnd = moov.at + moov.size;
  const udta = await findBox(read, moov.at + moov.header, moovEnd, 'udta');
  if (!udta) return tags;
  const meta = await findBox(read, udta.at + udta.header, udta.at + udta.size, 'meta');
  if (!meta) return tags;
  // ISO's `meta` carries a version and flags before its children; QuickTime's
  // goes straight into them. Which one this is shows in what comes next.
  const peek = await read(meta.at + meta.header, 8);
  const children = meta.at + meta.header + (peek.length >= 8 && fourCC(peek, 4) === 'hdlr' ? 0 : 4);
  const ilst = await findBox(read, children, meta.at + meta.size, 'ilst');
  if (!ilst || !Number.isFinite(ilst.size)) return tags;
  const start = ilst.at + ilst.header;
  const length = ilst.size - ilst.header;
  if (withCover || length <= maxBytes) {
    return parseIlst(await read(start, Math.min(length, Math.max(maxBytes, 0))), withCover);
  }
  // Too big for the text pass, which is the cover: item by item, skipping it.
  let at = start;
  for (let hops = 0; at + 8 <= start + length && hops < MAX_HOPS; hops++) {
    const h = await read(at, 8);
    if (h.length < 8) break;
    const size = u32BE(h, 0);
    if (size < 8) break;
    if (fourCC(h, 4) === 'covr') {
      tags.cutFrame = 'APIC';
    } else if (size <= maxBytes) {
      const item = parseIlst(await read(at, size), false);
      for (const [k, v] of Object.entries(item)) if (v !== undefined) (tags as Record<string, unknown>)[k] = v;
    }
    at += size;
  }
  return tags;
}

/** A FLAC file's Vorbis comments and front cover, from its metadata blocks. */
export async function readFlacTags(read: ByteReader, withCover: boolean, maxBytes: number): Promise<ID3Tags> {
  const tags: ID3Tags = {};
  let at = 4;
  for (let hops = 0; hops < MAX_HOPS; hops++) {
    const h = await read(at, 4);
    if (h.length < 4) break;
    const last = (h[0] & 0x80) !== 0;
    const type = h[0] & 0x7f;
    const length = (h[1] << 16) | (h[2] << 8) | h[3];
    const body = at + 4;
    if (type === FLAC_VORBIS_COMMENT) {
      parseVorbisComment(await read(body, Math.min(length, MAX_COMMENT_BYTES)), tags);
    } else if (type === FLAC_PICTURE) {
      if (!withCover) tags.cutFrame = 'APIC';
      else if (length <= maxBytes) parseFlacPicture(await read(body, length), tags);
    }
    if (last) break;
    at = body + length;
  }
  return tags;
}
