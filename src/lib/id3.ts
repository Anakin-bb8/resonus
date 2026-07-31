/**
 * ID3 parser for React Native (Hermes).
 * Supports ID3v2 (header) and ID3v1 (end of file, as fallback).
 * Reads title, artist, album, track number, year and embedded cover art (ID3v2).
 */
function synchsafeToInt(b: Uint8Array, offset: number): number {
  return (
    ((b[offset] & 0x7f) << 21) |
    ((b[offset + 1] & 0x7f) << 14) |
    ((b[offset + 2] & 0x7f) << 7) |
    (b[offset + 3] & 0x7f)
  );
}

function int32BE(b: Uint8Array, offset: number): number {
  return (b[offset] << 24) | (b[offset + 1] << 16) | (b[offset + 2] << 8) | b[offset + 3];
}

const utf8Decoder = new TextDecoder('utf-8');

function decodeLatin1(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
}

/**
 * Manually decodes UTF-16 (Hermes doesn't support `TextDecoder('utf-16le')`
 * and would throw, breaking the entire ID3v2 parse). Reads 2-byte units;
 * surrogate pairs are reconstructed automatically on concatenation.
 */
function decodeUtf16(bytes: Uint8Array, littleEndian: boolean): string {
  let out = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const code = littleEndian
      ? bytes[i] | (bytes[i + 1] << 8)
      : (bytes[i] << 8) | bytes[i + 1];
    out += String.fromCharCode(code);
  }
  return out;
}

/** Decodes frame bytes according to its ID3 encoding byte. */
function decodeWithEncoding(enc: number, data: Uint8Array): string {
  switch (enc) {
    case 0x00:
      return decodeLatin1(data);
    case 0x03:
      return utf8Decoder.decode(data);
    case 0x01: {
      if (data.length < 2) return '';
      // BOM: FF FE = little-endian, FE FF = big-endian.
      const littleEndian = data[0] === 0xff && data[1] === 0xfe;
      return decodeUtf16(data.subarray(2), littleEndian);
    }
    case 0x02:
      return decodeUtf16(data, false); // UTF-16BE without BOM
    default:
      return decodeLatin1(data);
  }
}

function decodeText(b: Uint8Array, start: number, end: number): string {
  if (start >= end) return '';
  const text = decodeWithEncoding(b[start], b.subarray(start + 1, end));
  // In ID3v2.4 text frames may contain multiple values separated by a null
  // byte (e.g. TPE1 = "6ix9ine\0Anuel AA"). Previously nulls were removed
  // and values got stuck together ("6ix9ineAnuel AA"); now we take the first
  // value (the primary one), which is what gets displayed.
  const first = text.split('\0').map((s) => s.trim()).find((s) => s.length > 0);
  return first ?? '';
}

function nullTerminatedIndex(b: Uint8Array, start: number, max: number): number {
  for (let i = start; i < max; i++) {
    if (b[i] === 0) return i;
  }
  return max;
}

/**
 * Decodes the frames shaped `<encoding(1)> <language(3)> <null-terminated
 * description> <text>`: the lyrics (USLT) and the comment (COMM) are laid out
 * the same, so skipping past the description is the same walk in both.
 */
function decodeDescribedText(data: Uint8Array): string | undefined {
  if (data.length < 5) return undefined;
  const enc = data[0];
  const wide = enc === 0x01 || enc === 0x02; // UTF-16: two-byte null
  let p = 4;
  if (wide) {
    while (p + 1 < data.length && (data[p] !== 0 || data[p + 1] !== 0)) p += 2;
    p += 2;
  } else {
    p = nullTerminatedIndex(data, p, data.length) + 1;
  }
  if (p >= data.length) return undefined;
  const text = decodeWithEncoding(enc, data.subarray(p)).replace(/\0+$/, '').trim();
  return text || undefined;
}

export interface ID3Tags {
  title?: string;
  artist?: string;
  /** Album artist (TPE2); more reliable for grouping than the track artist. */
  albumArtist?: string;
  album?: string;
  track?: number;
  year?: number;
  coverMime?: string;
  coverBase64?: string;
  /** Embedded lyrics (USLT frame); may come in LRC format with timestamps. */
  lyrics?: string;
  /** Comment tag (COMM frame). The only source of it without a server (#59). */
  comment?: string;
  /**
   * Frame id that didn't fit fully in the buffer: the tag was truncated and
   * nothing beyond this point was read. `undefined` if the full tag was parsed.
   */
  cutFrame?: string;
}

function parseID3v2(buffer: Uint8Array): ID3Tags {
  const tags: ID3Tags = {};
  if (buffer.length < 10) return tags;
  if (buffer[0] !== 0x49 || buffer[1] !== 0x44 || buffer[2] !== 0x33) return tags;

  const verMajor = buffer[3];
  const flags = buffer[5];
  const tagSize = synchsafeToInt(buffer, 6);

  let offset = 10;
  if (verMajor >= 4 && (flags & 0x40) && offset + 4 <= buffer.length) {
    const extSize = synchsafeToInt(buffer, offset);
    offset += 4 + extSize;
  }

  const tagEnd = Math.min(offset + tagSize, buffer.length);
  let prevFrameId = '';

  while (offset + 10 <= tagEnd) {
    const frameId = String.fromCharCode(
      buffer[offset], buffer[offset + 1], buffer[offset + 2], buffer[offset + 3],
    );
    if (frameId.charCodeAt(0) === 0 || !/^[A-Z0-9]{4}$/.test(frameId)) break;

    let frameSize: number;
    if (verMajor >= 4) {
      frameSize = synchsafeToInt(buffer, offset + 4);
    } else {
      frameSize = int32BE(buffer, offset + 4);
    }
    if (frameSize < 0 || frameSize > 50_000_000) break;

    const dataStart = offset + 10;
    if (dataStart >= tagEnd) break;
    // The frame doesn't fully fit in what was read. This is normal on the
    // first scan pass, which only requests the tag header to skip the cover
    // art (see `readTags` in localLibrary). Neither a half JPEG nor a half
    // title is useful, so we stop and record in `cutFrame` where the cut
    // happened, so the caller can decide whether to re-read.
    if (dataStart + frameSize > tagEnd) {
      tags.cutFrame = frameId;
      break;
    }
    const dataEnd = dataStart + frameSize;

    const data = buffer.subarray(dataStart, dataEnd);

    switch (frameId) {
      case 'TIT2': tags.title = decodeText(data, 0, data.length) || undefined; break;
      case 'TPE1': tags.artist = decodeText(data, 0, data.length) || undefined; break;
      case 'TPE2': tags.albumArtist = decodeText(data, 0, data.length) || undefined; break;
      case 'TALB': tags.album = decodeText(data, 0, data.length) || undefined; break;
      case 'TRCK': {
        const raw = decodeText(data, 0, data.length);
        const num = parseInt(raw.split('/')[0], 10);
        if (!isNaN(num)) tags.track = num;
        break;
      }
      case 'TYER':
      case 'TDRC': {
        const raw = decodeText(data, 0, data.length);
        const num = parseInt(raw.slice(0, 4), 10);
        if (!isNaN(num)) tags.year = num;
        break;
      }
      case 'USLT': {
        tags.lyrics = decodeDescribedText(data) ?? tags.lyrics;
        break;
      }
      case 'COMM': {
        // A file can carry several, one per language, and some encoders leave
        // their own behind ("Created by…"). The first non-empty one is the one
        // a person typed, and the one they expect to read back (#59).
        if (!tags.comment) tags.comment = decodeDescribedText(data);
        break;
      }
      case 'APIC': {
        if (data.length < 4) break;
        const mimeEnd = nullTerminatedIndex(data, 1, data.length);
        const mime = decodeLatin1(data.subarray(1, mimeEnd)).trim() || 'image/jpeg';
        const descEnd = nullTerminatedIndex(data, mimeEnd + 2, data.length);
        const picData = data.subarray(descEnd + 1);
        if (picData.length > 0) {
          tags.coverMime = mime;
          tags.coverBase64 = uint8ToBase64(picData);
          // If the cover is large, we skip further frames to avoid losing
          // them — but we're already within tagEnd so it's safe.
        }
        break;
      }
    }

    // Prevents infinite loop if frameSize = 0
    if (dataEnd === offset && frameId === prevFrameId) break;
    prevFrameId = frameId;
    offset = dataEnd;
  }

  return tags;
}

/** Parses the last 128 bytes as ID3v1 (fallback). */
function parseID3v1(buffer: Uint8Array): ID3Tags {
  const tags: ID3Tags = {};
  if (buffer.length < 128) return tags;
  // "TAG" is in the last 128 bytes
  const start = buffer.length - 128;
  if (buffer[start] !== 0x54 || buffer[start + 1] !== 0x41 || buffer[start + 2] !== 0x47) return tags;

  tags.title = decodeLatin1(buffer.subarray(start + 3, start + 33)).replace(/\0/g, '').trim() || undefined;
  tags.artist = decodeLatin1(buffer.subarray(start + 33, start + 63)).replace(/\0/g, '').trim() || undefined;
  tags.album = decodeLatin1(buffer.subarray(start + 63, start + 93)).replace(/\0/g, '').trim() || undefined;
  const yearRaw = decodeLatin1(buffer.subarray(start + 93, start + 97)).replace(/\0/g, '').trim();
  const yearNum = parseInt(yearRaw, 10);
  if (!isNaN(yearNum)) tags.year = yearNum;

  // Track (ID3v1.1): if comment[28] == 0, comment[29] is the track
  if (buffer[start + 125] === 0 && buffer[start + 126] !== 0) {
    tags.track = buffer[start + 126];
  }
  return tags;
}

export function parseID3(buffer: Uint8Array): ID3Tags {
  try {
    const v2 = parseID3v2(buffer);
    if (v2.title) return v2; // ID3v2 takes priority if it found a title
    // If ID3v2 found nothing useful, fall back to ID3v1 (last 128 bytes).
    const v1 = parseID3v1(buffer);
    return { ...v1, ...v2 }; // v2 overrides v1 where data exists
  } catch {
    return {};
  }
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return globalThis.btoa(binary);
}

export function base64ToUint8(base64: string, maxBytes?: number): Uint8Array {
  const binary = globalThis.atob(base64);
  const len = maxBytes != null ? Math.min(binary.length, maxBytes) : binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
