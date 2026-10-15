/**
 * Karaoke sweep model (BitChord port): fractional wipe, lift envelope,
 * active/focus indices and instrumental gaps.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { LyricLine } from '@/api/subsonic';
import { wordEnds } from '@/lib/lyricWords';
import {
  activeIndex,
  focusIndex,
  gapAfterMs,
  gapThrough,
  hasGapAfter,
  hasIntroGap,
  introGapMs,
  revealedChars,
  stanzaBreaks,
  sweepProgress,
  wordFill,
  wordLift,
} from '@/lib/lyricSweep';

const line = (start: number, value: string, words?: { start: number; value: string; end?: number }[]): LyricLine => ({
  start,
  value,
  ...(words ? { words: words.map((w) => ({ ...w })) } : {}),
});

describe('revealedChars', () => {
  it('is 0 before the line and whole past its words', () => {
    const l = line(1000, 'hey you', [
      { start: 1000, value: 'hey ' },
      { start: 1500, value: 'you' },
    ]);
    const ends = wordEnds(l.words!, 3000);
    assert.equal(revealedChars(l.value, l.words, ends, 1000, 500), 0);
    assert.equal(revealedChars(l.value, l.words, ends, 1000, 1000), 0);
    assert.equal(revealedChars(l.value, l.words, ends, 1000, 9999), l.value.length);
  });

  it('moves mid-word, fractionally', () => {
    const l = line(1000, 'hey you', [
      { start: 1000, value: 'hey ' },
      { start: 2000, value: 'you' },
    ]);
    const ends = wordEnds(l.words!, 5000);
    const mid = revealedChars(l.value, l.words, ends, 1000, 1500);
    assert.ok(mid > 0 && mid < l.value.length, `mid-word, got ${mid}`);
    const later = revealedChars(l.value, l.words, ends, 1000, 2500);
    assert.ok(later > mid, `monotonic, got ${later} after ${mid}`);
  });

  it('lights a line without words whole once started', () => {
    const l = line(1000, 'plain line');
    assert.equal(revealedChars(l.value, undefined, undefined, 1000, 999), 0);
    assert.equal(revealedChars(l.value, undefined, undefined, 1000, 1000), l.value.length);
  });

  it('sweepProgress is 0..1', () => {
    const l = line(0, 'ab', [{ start: 0, value: 'ab' }]);
    const ends = wordEnds(l.words!, 2000);
    assert.equal(sweepProgress(l.value, l.words, ends, 0, -1), 0);
    assert.equal(sweepProgress(l.value, l.words, ends, 0, 1e9), 1);
  });
});

describe('wordFill / wordLift', () => {
  it('fills 0 before, 1 after', () => {
    assert.equal(wordFill(1000, 2000, 999), 0);
    assert.equal(wordFill(1000, 2000, 2000), 1);
    assert.equal(wordFill(1000, 2000, 1500), 0.5);
  });

  it('lifts while sung and settles after', () => {
    assert.equal(wordLift(1000, 2000, 500), 0);
    assert.ok(wordLift(1000, 2000, 1500) > 0);
    assert.equal(wordLift(1000, 2000, 1000 + 700 + 5000), 0);
  });
});

describe('activeIndex / focusIndex', () => {
  const lines = [line(0, 'one'), line(2000, 'two'), line(4000, 'three')];
  it('tracks the latest started line', () => {
    assert.equal(activeIndex(lines, -1), -1);
    assert.equal(activeIndex(lines, 0), 0);
    assert.equal(activeIndex(lines, 2500), 1);
  });

  it('looks slightly ahead for scrolling', () => {
    // No words -> no known end -> lead is the 350ms minimum.
    assert.equal(focusIndex(lines, 1600), 0);
    assert.equal(focusIndex(lines, 1700), 1);
    assert.equal(focusIndex(lines, 100), 0);
  });
});

describe('gaps', () => {
  it('detects instrumental silence', () => {
    const lines = [line(0, 'one', [{ start: 0, value: 'one' }]), line(10000, 'two')];
    assert.ok(gapAfterMs(lines, 0) > 4000);
    assert.ok(hasGapAfter(lines, 0));
    assert.ok(!hasGapAfter(lines, 1));
    assert.equal(gapThrough(lines, 0, 0), 0);
    assert.ok(gapThrough(lines, 0, 5000) > 0 && gapThrough(lines, 0, 5000) < 1);
  });

  it('shows dots for a late first line too', () => {
    assert.ok(!hasIntroGap([line(1000, 'early')]));
    const late = [line(8000, 'late'), line(12000, 'later')];
    assert.ok(hasIntroGap(late));
    assert.equal(introGapMs(late), 8000);
  });
});

describe('stanzaBreaks', () => {
  it('honours the source marks, never the first line', () => {
    const lines = [
      { ...line(0, 'one'), newStanza: true },
      line(2000, 'two'),
      { ...line(9000, 'three'), newStanza: true },
    ];
    assert.deepEqual([...stanzaBreaks(lines)], [2]);
  });

  it('falls back to long silences when the source marks none', () => {
    // 2s inside a verse: no break. 5s between verses: break.
    const lines = [line(0, 'one'), line(2000, 'two'), line(9000, 'three')];
    assert.deepEqual([...stanzaBreaks(lines)], [2]);
    assert.deepEqual([...stanzaBreaks([line(0, 'one')])], []);
  });

  it('stays quiet on untimed lyrics', () => {
    assert.deepEqual([...stanzaBreaks([{ value: 'one' }, { value: 'two' }])], []);
  });
});
