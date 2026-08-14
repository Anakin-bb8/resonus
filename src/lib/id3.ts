/**
 * ID3 parser for React Native (Hermes).
 * Supports ID3v2 (header) and ID3v1 (end of file, as fallback).
 * Reads title, artist, album, track number, year and embedded cover art (ID3v2).
 *
 * A word on how strict it is, because that turned out to be the whole of a bug
 * (#141). A tag is written by whatever put the file together and read by
 * everybody, and the writers get it wrong often enough that the readers have
 * all had to learn to forgive: sizes written the version's other way,
 * unsynchronisation, a description in the encoding the frame did not name. Every
 * one of those loses the picture while leaving the text perfectly readable,
 * which is why a file can look correctly scanned and have no cover anywhere.
 * Where this parser cannot trust what a tag says, it now works out what was
 * meant rather than stopping, and a tag that was already well formed takes byte
 * for byte the same path it always did.
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

/**
 * Undoes unsynchronisation: every `FF 00` goes back to being an `FF`.
 *
 * The scheme exists so that nothing inside a tag can be mistaken for the start
 * of an audio frame, and the cost of it lands on whoever reads the tag. Text
 * barely notices, because text hardly ever contains an `FF`. A picture is full
 * of them, and comes out with a zero wedged after each one, which is not a JPEG
 * any more: that is a file that reads as perfectly titled and stubbornly
 * coverless.
 */
function deUnsynchronise(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length);
  let n = 0;
  for (let i = 0; i < data.length; i++) {
    out[n++] = data[i];
    if (data[i] === 0xff && data[i + 1] === 0x00) i++;
  }
  return out.subarray(0, n);
}

/** The bytes a frame id is made of: capitals and digits, nothing else. */
function looksLikeFrameId(b: Uint8Array, at: number): boolean {
  for (let i = at; i < at + 4; i++) {
    const c = b[i];
    if (!((c >= 0x41 && c <= 0x5a) || (c >= 0x30 && c <= 0x39))) return false;
  }
  return true;
}

/**
 * Whether a frame ending here is followed by another frame, by the padding, or
 * by nothing at all. Those are the only three things that can follow one.
 */
function frameEndValidates(b: Uint8Array, end: number, tagEnd: number): boolean {
  if (end === tagEnd) return true;
  if (end < 0 || end > tagEnd) return false;
  if (b[end] === 0) return true;
  return end + 10 <= tagEnd && looksLikeFrameId(b, end);
}

/**
 * The size of the frame whose header starts at `at`.
 *
 * 2.3 writes it as a plain 32 bit number and 2.4 as a synchsafe one, and a fair
 * number of encoders write a 2.4 header with 2.3 sizes inside it. Two things
 * give that away. A synchsafe byte never has its top bit set, so a size with one
 * set is not synchsafe whatever the header claims. And where both readings are
 * legal numbers, the true one is the one that lands on the next frame, on the
 * padding, or exactly at the end of the tag.
 *
 * A well formed tag is right on the first reading, and a 2.3 tag never gets
 * here at all, so nothing that parses today is read any differently.
 */
function frameSizeAt(b: Uint8Array, at: number, verMajor: number, tagEnd: number): number {
  const plain = int32BE(b, at + 4);
  if (verMajor < 4) return plain;
  const sync = synchsafeToInt(b, at + 4);
  if (sync === plain) return sync; // under 128 bytes there is no difference
  if ((b[at + 4] | b[at + 5] | b[at + 6] | b[at + 7]) & 0x80) return plain;
  if (frameEndValidates(b, at + 10 + sync, tagEnd)) return sync;
  if (frameEndValidates(b, at + 10 + plain, tagEnd)) return plain;
  // Neither reading leads anywhere. Where the plain one runs past what was
  // read, saying so is worth more than a shorter size that lands nowhere: it
  // sends the caller back for the rest of the tag instead of keeping half a
  // picture.
  return at + 10 + plain > tagEnd ? plain : sync;
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

/**
 * Decodes a user-defined text frame (TXXX): `<encoding(1)> <null-terminated
 * description> <value>`. Laid out like the frames above minus the language,
 * and with the description being the point rather than something to walk past:
 * it is the name of whatever tag an encoder invented, and there is no other way
 * to tell one TXXX from the next.
 */
function decodeUserText(data: Uint8Array): { name: string; value: string } | undefined {
  if (data.length < 3) return undefined;
  const enc = data[0];
  const wide = enc === 0x01 || enc === 0x02; // UTF-16: two-byte null
  let end = 1;
  if (wide) {
    while (end + 1 < data.length && (data[end] !== 0 || data[end + 1] !== 0)) end += 2;
  } else {
    end = nullTerminatedIndex(data, 1, data.length);
  }
  const start = end + (wide ? 2 : 1);
  if (start >= data.length) return undefined;
  const name = decodeWithEncoding(enc, data.subarray(1, end)).replace(/\0+$/, '').trim();
  const value = decodeWithEncoding(enc, data.subarray(start)).replace(/\0+$/, '').trim();
  if (!name || !value) return undefined;
  return { name: name.toUpperCase(), value };
}

/**
 * Reads the picture out of an APIC frame body, laid out as `<encoding(1)>
 * <mime, null terminated> <picture type(1)> <description, null terminated>
 * <picture>`.
 *
 * The description is text like any other and is written in whatever encoding
 * the first byte names, so in UTF-16 it ends in TWO zero bytes. Walking to the
 * first single zero left the second one in front of the picture, and a JPEG
 * with a byte in front of it is not a JPEG: the cover came whole out of the
 * tag and was then thrown away by everything that tried to draw it.
 */
function readPicture(data: Uint8Array, tags: ID3Tags): void {
  if (data.length < 4) return;
  const enc = data[0];
  const mimeEnd = nullTerminatedIndex(data, 1, data.length);
  const mime = decodeLatin1(data.subarray(1, mimeEnd)).trim() || 'image/jpeg';
  // The spec lets a frame carry a link to a picture instead of the picture,
  // spelled with this mime type. There is nothing in it to draw.
  if (mime === '-->') return;
  let at = mimeEnd + 2; // past the terminator and the picture type byte
  if (enc === 0x01 || enc === 0x02) {
    while (at + 1 < data.length && (data[at] !== 0 || data[at + 1] !== 0)) at += 2;
    at += 2;
  } else {
    at = nullTerminatedIndex(data, at, data.length) + 1;
  }
  if (at >= data.length) return;
  tags.coverMime = mime;
  tags.coverBase64 = uint8ToBase64(data.subarray(at));
}

/**
 * Where the picture frame starts, found by its own name instead of by walking to
 * it. `-1` when there is none to find.
 *
 * Four letters are a weak signature by themselves, and this is looked for
 * inside a tag that quite possibly contains a picture whose bytes can spell
 * anything, so the frame has to look like one too: an encoding byte that
 * exists, and a mime type that begins the way every picture's does.
 */
function findPictureFrame(b: Uint8Array, from: number, to: number): number {
  for (let at = from; at + 17 < to; at++) {
    if (b[at] !== 0x41 || b[at + 1] !== 0x50 || b[at + 2] !== 0x49 || b[at + 3] !== 0x43) continue;
    if (b[at + 10] > 0x03) continue;
    if (decodeLatin1(b.subarray(at + 11, at + 17)).toLowerCase() !== 'image/') continue;
    return at;
  }
  return -1;
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
   * Parental advisory, in the words the rest of the app uses ("explicit" /
   * "clean"). Written by iTunes as `TXXX:ITUNESADVISORY`, which is also the
   * tag Navidrome reads, so a file that shows the E on a server shows it here
   * too.
   */
  explicitStatus?: string;
  /**
   * Frame id that didn't fit fully in the buffer: the tag was truncated and
   * nothing beyond this point was read. `undefined` if the full tag was parsed.
   */
  cutFrame?: string;
}

function parseID3v2(input: Uint8Array): ID3Tags {
  const tags: ID3Tags = {};
  let buffer = input;
  if (buffer.length < 10) return tags;
  if (buffer[0] !== 0x49 || buffer[1] !== 0x44 || buffer[2] !== 0x33) return tags;

  const verMajor = buffer[3];
  const flags = buffer[5];
  let tagSize = synchsafeToInt(buffer, 6);

  // A whole tag can be unsynchronised, which is how 2.3 does it, and then the
  // frame sizes are the sizes from before it happened: undoing it has to come
  // before the walk or every offset past the first `FF 00` is wrong. 2.4 marks
  // it frame by frame and stores the size after the fact, so there it is left
  // to the frames themselves, below.
  if ((flags & 0x80) && verMajor < 4) {
    const body = deUnsynchronise(buffer.subarray(10, Math.min(10 + tagSize, buffer.length)));
    const joined = new Uint8Array(10 + body.length);
    joined.set(buffer.subarray(0, 10));
    joined.set(body, 10);
    buffer = joined;
    tagSize = body.length;
  }

  let offset = 10;
  if ((flags & 0x40) && offset + 4 <= buffer.length) {
    // 2.4 writes a synchsafe size that counts the whole extended header; 2.3
    // writes a plain one that leaves its own four bytes out. Reading either the
    // other way lands the walk inside the header, where the first thing that is
    // not a frame id ends the parse with nothing at all to show.
    offset += verMajor >= 4 ? synchsafeToInt(buffer, offset) : 4 + int32BE(buffer, offset);
  }

  const tagEnd = Math.min(10 + tagSize, buffer.length);
  let prevFrameId = '';

  while (offset + 10 <= tagEnd) {
    const frameId = String.fromCharCode(
      buffer[offset], buffer[offset + 1], buffer[offset + 2], buffer[offset + 3],
    );
    // Where the frames end there is padding, all zeros, which fails this for
    // the same reason anything else that is not a frame id does.
    if (!looksLikeFrameId(buffer, offset)) break;

    const frameSize = frameSizeAt(buffer, offset, verMajor, tagEnd);
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

    let data = buffer.subarray(dataStart, dataEnd);
    // 2.4's own way of unsynchronising: one frame at a time, either because the
    // frame says so or because the header said all of them do.
    if (verMajor >= 4 && ((flags & 0x80) || (buffer[offset + 9] & 0x02))) {
      data = deUnsynchronise(data);
    }

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
      case 'TXXX': {
        // The only one worth reading here. iTunes writes a number: 1 explicit,
        // 2 clean, 0 (or nothing at all) for a record nobody rated.
        const pair = decodeUserText(data);
        if (pair?.name === 'ITUNESADVISORY') {
          if (pair.value === '1') tags.explicitStatus = 'explicit';
          else if (pair.value === '2') tags.explicitStatus = 'clean';
        }
        break;
      }
      case 'APIC': {
        readPicture(data, tags);
        break;
      }
    }

    // Prevents infinite loop if frameSize = 0
    if (dataEnd === offset && frameId === prevFrameId) break;
    prevFrameId = frameId;
    offset = dataEnd;
  }

  // A tag the walk cannot get through usually has nothing else wrong with it:
  // the picture is in there, whole, and can be found by looking for the frame's
  // own name. Without this, one frame written by an encoder nobody has heard of
  // costs the cover of every record in the library, and silently, because a
  // walk that stops early does not know there was an APIC ahead of it and never
  // sets `cutFrame` for the caller to act on.
  //
  // Only tried where the walk left tag behind and no cover with it, so a tag
  // that reads cleanly never comes near it.
  if (!tags.coverBase64 && !tags.cutFrame && offset + 10 < tagEnd) {
    const at = findPictureFrame(buffer, offset, tagEnd);
    if (at >= 0) {
      const size = frameSizeAt(buffer, at, verMajor, tagEnd);
      if (at + 10 + size > tagEnd) {
        // The picture runs past what was read. Saying so is what sends the
        // caller back for the whole tag, exactly as a walk cut short here does.
        tags.cutFrame = 'APIC';
      } else {
        let end = at + 10 + size;
        if (!frameEndValidates(buffer, end, tagEnd)) {
          // The size is no more trustworthy than the walk was. What follows a
          // picture is another frame or the padding, and every decoder stops at
          // the end of an image on its own, so handing over the rest of the tag
          // loses nothing and keeps whole what a bad size would cut in half.
          end = tagEnd;
          while (end > at + 10 && buffer[end - 1] === 0) end--;
        }
        readPicture(buffer.subarray(at + 10, end), tags);
      }
    }
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
