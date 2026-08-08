/**
 * Navidrome's canonical id transform, ported to the client.
 *
 * Navidrome 0.64 rewrites every id in its database to one shape: the 22-char
 * base62 encoding of a 128-bit value (navidrome/navidrome#5824, migration
 * `20260720015443_uniform_canonical_ids.go`). Ids that used to be a 32-char
 * hash, or a playlist UUID, all become something else on the day the server is
 * upgraded.
 *
 * We keep server ids as primary keys in the download catalog and the offline
 * mirror, and in the queue, the pins and the outbox. A server that migrates
 * without us noticing leaves every one of those pointing at something that no
 * longer exists, which on a profile with downloads is the whole offline
 * library. Reproducing the transform here is what lets that be repaired on the
 * phone: each old id maps to its new one with no round trip, no matching songs
 * by title, and no need for a connection at the time.
 *
 * The transform is a pure function of the id's *shape*, so it says nothing
 * about whether a given server has migrated yet. Deciding that is the caller's
 * job and it must be decided by asking the server, never inferred from an id
 * that stopped resolving: a song that was deleted looks exactly the same.
 *
 * Two things here look like details and are not:
 *
 * - The base62 alphabet is digits, then LOWERCASE, then uppercase, which is
 *   what Go's `big.Int` uses for bases above 36. Navidrome's older nanoid
 *   alphabet ran uppercase first. Swapping the two halves produces ids that
 *   are the right length, the right character set and entirely wrong.
 * - MusicBrainz ids must never be passed through here. An MBID is 36
 *   characters with dashes in the same places as a legacy playlist UUID, so
 *   this function cannot tell them apart and will happily rewrite one. The
 *   server leaves its `mbz_*` columns alone; so must every caller of this.
 */

/** Go's `big.Int` alphabet for bases over 36: digits, lower case, upper case. */
const BASE62 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const CANONICAL_LENGTH = 22;
/** A canonical id is 128 bits, which is what fits in the working buffers here. */
const BYTES = 16;

const HEX = /^[0-9a-fA-F]+$/;
const UUID_DASHES = [8, 13, 18, 23];

/**
 * Multi-byte arithmetic rather than `BigInt`, deliberately.
 *
 * `BigInt` would read better, but this runs on Hermes and it is the kind of
 * code whose failure is silent: a remap that throws on the phone would be
 * found by a user with a broken library, not by a type check. Sixteen bytes of
 * long multiplication has no engine support to depend on, and carrying out of
 * the top byte *is* the "does not fit in 128 bits" test the transform needs,
 * so the check comes for free instead of being a second thing to get right.
 */
type Parsed =
  /** Not base62 at all: a character outside the alphabet. */
  | { kind: 'invalid' }
  /** Fits in 128 bits: Go's `BitLen() <= 128`, the ids left untouched. */
  | { kind: 'fits'; bytes: Uint8Array }
  /** Needs more than 128 bits: an old-alphabet nanoid, remapped through md5. */
  | { kind: 'overflow' };

function parseBase62(input: string): Parsed {
  const out = new Uint8Array(BYTES);
  for (const char of input) {
    const digit = BASE62.indexOf(char);
    if (digit < 0) return { kind: 'invalid' };
    // out = out * 62 + digit, most significant byte first.
    let carry = digit;
    for (let i = BYTES - 1; i >= 0; i--) {
      const value = out[i] * 62 + carry;
      out[i] = value & 0xff;
      carry = value >>> 8;
    }
    if (carry !== 0) return { kind: 'overflow' };
  }
  return { kind: 'fits', bytes: out };
}

/** 16 bytes as base62, zero padded to 22 (Go's `%022s`). '0' is base62's zero
 *  digit, so padding with it preserves the value. */
function encode(bytes: Uint8Array): string {
  const work = Uint8Array.from(bytes);
  let out = '';
  for (;;) {
    // One long division of the whole buffer by 62; the remainder is the next
    // digit, taken least significant first.
    let remainder = 0;
    let rest = false;
    for (let i = 0; i < BYTES; i++) {
      const current = (remainder << 8) | work[i];
      work[i] = (current / 62) | 0;
      remainder = current % 62;
      if (work[i] !== 0) rest = true;
    }
    out = BASE62[remainder] + out;
    if (!rest) break;
  }
  return out.padStart(CANONICAL_LENGTH, '0');
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** The 32 hex characters of a UUID, or null if the dashes are not a UUID's. */
function uuidToHex(input: string): string | null {
  if (UUID_DASHES.some((index) => input[index] !== '-')) return null;
  const hex =
    input.slice(0, 8) +
    input.slice(9, 13) +
    input.slice(14, 18) +
    input.slice(19, 23) +
    input.slice(24);
  return HEX.test(hex) ? hex : null;
}

/**
 * The canonical form of one id. Any shape the server does not rewrite, and
 * anything unrecognised, comes back exactly as it went in.
 *
 * Idempotent: the canonical form of a canonical id is itself, so replaying a
 * remap that was interrupted cannot double-apply it.
 */
export function canonicalId(id: string): string {
  switch (id.length) {
    case CANONICAL_LENGTH: {
      const parsed = parseBase62(id);
      // Already canonical, or not base62: either way the server keeps it.
      if (parsed.kind !== 'overflow') return id;
      // An id from the old uppercase-first alphabet: too big to be a 128-bit
      // value, so the server hashes the text of it rather than re-encoding.
      return encode(md5(id));
    }
    case 32:
      return HEX.test(id) ? encode(hexToBytes(id)) : id;
    case 36: {
      const hex = uuidToHex(id);
      return hex === null ? id : encode(hexToBytes(hex));
    }
    default:
      return id;
  }
}

/**
 * Whether the transform would change this id, without doing the work.
 *
 * This is the cheap gate on every hot path: an id it says no to resolves the
 * same before and after the migration, so it is no evidence of anything and
 * never worth a probe, a retry or a row in a remap.
 */
export function idWouldChange(id: string): boolean {
  return canonicalId(id) !== id;
}

/* -------------------------------------------------------------------------- */

/**
 * md5, in JavaScript, for the one branch that needs it.
 *
 * `expo-crypto` has md5 but only as a promise, which would make the whole
 * transform async for a case that is a minority of ids, and would put a native
 * call in the middle of a remap loop and inside the request path. It would
 * also stop any of this being checkable outside a device, and this file's
 * whole value is that it can be verified against Navidrome's own test vectors
 * on a laptop. The input here is always 22 ASCII characters.
 */
function md5(input: string): Uint8Array {
  const S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9,
    14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];
  // K[i] = floor(abs(sin(i + 1)) * 2^32), the table from RFC 1321.
  const K = new Uint32Array(64);
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000);

  const bytes = utf8(input);
  // Padding: a single 1 bit, zeros, then the length in bits as 64-bit LE.
  const blocks = Math.floor((bytes.length + 8) / 64) + 1;
  const padded = new Uint8Array(blocks * 64);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const bits = bytes.length * 8;
  // A 22-character id is nowhere near 2^32 bits, so the high word stays zero.
  padded[padded.length - 8] = bits & 0xff;
  padded[padded.length - 7] = (bits >>> 8) & 0xff;
  padded[padded.length - 6] = (bits >>> 16) & 0xff;
  padded[padded.length - 5] = (bits >>> 24) & 0xff;

  let [a0, b0, c0, d0] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];

  for (let block = 0; block < blocks; block++) {
    const M = new Uint32Array(16);
    for (let i = 0; i < 16; i++) {
      const o = block * 64 + i * 4;
      M[i] = padded[o] | (padded[o + 1] << 8) | (padded[o + 2] << 16) | (padded[o + 3] << 24);
    }
    let [A, B, C, D] = [a0, b0, c0, d0];
    for (let i = 0; i < 64; i++) {
      let F: number;
      let g: number;
      if (i < 16) {
        F = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        F = (D & B) | (~D & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * i) % 16;
      }
      F = (F + A + K[i] + M[g]) | 0;
      A = D;
      D = C;
      C = B;
      B = (B + ((F << S[i]) | (F >>> (32 - S[i])))) | 0;
    }
    a0 = (a0 + A) | 0;
    b0 = (b0 + B) | 0;
    c0 = (c0 + C) | 0;
    d0 = (d0 + D) | 0;
  }

  const out = new Uint8Array(16);
  [a0, b0, c0, d0].forEach((word, w) => {
    out[w * 4] = word & 0xff;
    out[w * 4 + 1] = (word >>> 8) & 0xff;
    out[w * 4 + 2] = (word >>> 16) & 0xff;
    out[w * 4 + 3] = (word >>> 24) & 0xff;
  });
  return out;
}

/** UTF-8 bytes, without depending on TextEncoder being there. */
function utf8(input: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < input.length; i++) {
    const code = input.codePointAt(i) as number;
    if (code > 0xffff) i++;
    if (code < 0x80) out.push(code);
    else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0x10000)
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    else
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f)
      );
  }
  return Uint8Array.from(out);
}
