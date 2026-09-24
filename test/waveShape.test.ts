/** The waveform bar's shape: stable per song, within bounds. */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { waveShape } from '@/lib/waveShape';

describe('waveShape', () => {
  it('is the same every time for a song', () => {
    assert.deepEqual(waveShape('abc', 60), waveShape('abc', 60));
  });

  it('differs between songs', () => {
    assert.notDeepEqual(waveShape('abc', 60), waveShape('abd', 60));
  });

  it('stays between the floor and full height', () => {
    for (const h of waveShape('some-song-id', 120)) {
      assert.ok(h >= 0.18 && h <= 1, String(h));
    }
  });

  it('is quieter at the ends than in the middle', () => {
    const s = waveShape('x', 100);
    const mid = s.slice(40, 60).reduce((a, b) => a + b, 0) / 20;
    assert.ok(s[0] < mid && s[99] < mid);
  });

  it('copes with no room at all', () => {
    assert.deepEqual(waveShape('x', 0), []);
  });
});
