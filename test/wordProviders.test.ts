/** Word-by-word providers (src/lib/wordProviders.ts): pure mappings. */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { kpoeToLyrics, pickBiniLyricsUrl } from '@/lib/wordFormats';

describe('kpoeToLyrics', () => {
  it('maps word-level answers onto lines and words', () => {
    const out = kpoeToLyrics({
      type: 'Word',
      lyrics: [
        {
          time: 19764,
          duration: 2136,
          text: 'When you were here before',
          syllabus: [
            { time: 19764, duration: 341, text: 'When ' },
            { time: 20105, duration: 221, text: 'you ' },
            { time: 20326, duration: 500, text: 'were ' },
            { time: 20826, duration: 400, text: 'here ' },
            { time: 21226, duration: 674, text: 'before' },
          ],
        },
      ],
    });
    assert.ok(out?.synced);
    assert.equal(out?.lines.length, 1);
    assert.equal(out?.lines[0].start, 19764);
    assert.equal(out?.lines[0].words?.length, 5);
    assert.equal(out?.lines[0].words?.[0].value, 'When ');
    assert.equal(out?.lines[0].words?.[0].end, 19764 + 341);
  });

  it('keeps line-level answers wordless but synced', () => {
    const out = kpoeToLyrics({
      type: 'Line',
      lyrics: [{ time: 160, duration: 4970, text: 'Hello' }],
    });
    assert.ok(out?.synced);
    assert.equal(out?.lines[0].value, 'Hello');
    assert.equal(out?.lines[0].words, undefined);
  });

  it('drops empty lines and refuses garbage', () => {
    assert.equal(
      kpoeToLyrics({ type: 'Word', lyrics: [{ time: 10, text: '  ' }] })?.lines.length ?? 0,
      0,
    );
    assert.equal(kpoeToLyrics(null), null);
    assert.equal(kpoeToLyrics({}), null);
    assert.equal(kpoeToLyrics({ lyrics: 'nope' }), null);
  });
});

describe('pickBiniLyricsUrl', () => {
  const word = { timing_type: 'word', lyricsUrl: 'https://x/w.ttml' };
  const line = { timing_type: 'line', lyricsUrl: 'https://x/l.ttml' };
  it('prefers word timing', () => {
    assert.equal(pickBiniLyricsUrl([line, word]), 'https://x/w.ttml');
  });

  it('falls back to anything with lyrics', () => {
    assert.equal(pickBiniLyricsUrl([line]), 'https://x/l.ttml');
  });

  it('says nothing with nothing', () => {
    assert.equal(pickBiniLyricsUrl([]), null);
    assert.equal(pickBiniLyricsUrl(null), null);
    assert.equal(pickBiniLyricsUrl([{ timing_type: 'word' }]), null);
  });
});
