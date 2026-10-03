/**
 * M4A and FLAC tags for the local scan (#249), on files built byte by byte:
 * the cover read only when asked for, and `moov` found behind the audio.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { readFlacTags, readMp4Tags } from '@/lib/containerTags';

const enc = new TextEncoder();

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function u32BE(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}

function u32LE(n: number): Uint8Array {
  return u32BE(n).reverse();
}

function latin(s: string): Uint8Array {
  return new Uint8Array([...s].map((c) => c.charCodeAt(0)));
}

function box(type: string, ...body: Uint8Array[]): Uint8Array {
  const content = concat(...body);
  return concat(u32BE(8 + content.length), latin(type), content);
}

function item(type: string, dataType: number, value: Uint8Array): Uint8Array {
  return box(type, box('data', u32BE(dataType), u32BE(0), value));
}

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

function m4a(): Uint8Array {
  const ilst = box(
    'ilst',
    item('©nam', 1, enc.encode('Título')),
    item('©ART', 1, enc.encode('Some Artist')),
    item('aART', 1, enc.encode('Album Guy')),
    item('©alb', 1, enc.encode('The Album')),
    item('©day', 1, enc.encode('2019-05-01T00:00:00Z')),
    item('trkn', 0, new Uint8Array([0, 0, 0, 7, 0, 12, 0, 0])),
    item('rtng', 21, new Uint8Array([1])),
    item('covr', 13, JPEG),
  );
  // ISO `meta`: version and flags ahead of its children.
  const meta = box('meta', u32BE(0), box('hdlr', new Uint8Array(25)), ilst);
  const moov = box('moov', box('mvhd', new Uint8Array(100)), box('udta', meta));
  // The audio first and the index after it, as most encoders leave it.
  return concat(box('ftyp', latin('M4A '), u32BE(0)), box('mdat', new Uint8Array(5000)), moov);
}

function flac(): Uint8Array {
  const comments = ['TITLE=Título', 'ARTIST=Some Artist', 'ALBUMARTIST=Album Guy', 'ALBUM=The Album', 'TRACKNUMBER=7/12', 'DATE=2019'];
  const vorbis = concat(
    u32LE(4),
    latin('test'),
    u32LE(comments.length),
    ...comments.map((c) => {
      const b = enc.encode(c);
      return concat(u32LE(b.length), b);
    }),
  );
  const mime = latin('image/jpeg');
  const picture = concat(u32BE(3), u32BE(mime.length), mime, u32BE(0), new Uint8Array(16), u32BE(JPEG.length), JPEG);
  const block = (type: number, body: Uint8Array, last = false) =>
    concat(new Uint8Array([(last ? 0x80 : 0) | type, (body.length >> 16) & 0xff, (body.length >> 8) & 0xff, body.length & 0xff]), body);
  return concat(latin('fLaC'), block(0, new Uint8Array(34)), block(4, vorbis), block(6, picture, true), new Uint8Array(100));
}

function reader(file: Uint8Array) {
  return async (position: number, length: number) => file.subarray(position, position + length);
}

describe('readMp4Tags', () => {
  it('finds the tags behind the audio, and leaves the cover for later', async () => {
    const tags = await readMp4Tags(reader(m4a()), false, 16_384);
    assert.deepEqual(tags, {
      title: 'Título',
      artist: 'Some Artist',
      albumArtist: 'Album Guy',
      album: 'The Album',
      year: 2019,
      track: 7,
      explicitStatus: 'explicit',
      cutFrame: 'APIC',
    });
  });

  it('reads the cover when asked for it', async () => {
    const tags = await readMp4Tags(reader(m4a()), true, 2_500_000);
    assert.equal(tags.coverMime, 'image/jpeg');
    assert.equal(tags.coverBase64, Buffer.from(JPEG).toString('base64'));
    assert.equal(tags.cutFrame, undefined);
  });

  it('gives nothing, not an error, for a file with no tags', async () => {
    const bare = concat(box('ftyp', latin('M4A '), u32BE(0)), box('mdat', new Uint8Array(10)), box('moov'));
    assert.deepEqual(await readMp4Tags(reader(bare), false, 16_384), {});
  });
});

describe('readFlacTags', () => {
  it('reads the Vorbis comments and notes the cover', async () => {
    const tags = await readFlacTags(reader(flac()), false, 16_384);
    assert.deepEqual(tags, {
      title: 'Título',
      artist: 'Some Artist',
      albumArtist: 'Album Guy',
      album: 'The Album',
      track: 7,
      year: 2019,
      cutFrame: 'APIC',
    });
  });

  it('reads the picture block when asked for it', async () => {
    const tags = await readFlacTags(reader(flac()), true, 2_500_000);
    assert.equal(tags.coverMime, 'image/jpeg');
    assert.equal(tags.coverBase64, Buffer.from(JPEG).toString('base64'));
  });
});
