/** Which files the "lossless only" rule transcodes (#216). */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isLossless, transcodeTarget } from '@/lib/audioQuality';

describe('isLossless', () => {
  it('goes by the extension when it can only be one thing', () => {
    assert.equal(isLossless({ suffix: 'FLAC' }), true);
    assert.equal(isLossless({ suffix: 'wav' }), true);
    assert.equal(isLossless({ suffix: 'mp3', bitRate: 320 }), false);
    assert.equal(isLossless({ suffix: 'opus' }), false);
    // An MP3 is lossy whatever bitrate the server reports for it.
    assert.equal(isLossless({ suffix: 'mp3', bitRate: 1411 }), false);
  });

  it('tells ALAC from AAC in an m4a by the bit depth', () => {
    assert.equal(isLossless({ suffix: 'm4a', bitDepth: 16, bitRate: 900 }), true);
    assert.equal(isLossless({ suffix: 'm4a', bitDepth: 0, bitRate: 256 }), false);
    assert.equal(isLossless({ suffix: 'm4a', bitRate: 256 }), false);
  });

  it('falls back to the bitrate for anything else', () => {
    assert.equal(isLossless({ suffix: 'xyz', bitRate: 900 }), true);
    assert.equal(isLossless({ suffix: 'xyz', bitRate: 192 }), false);
    assert.equal(isLossless({}), false);
  });
});

describe('transcodeTarget', () => {
  const flac = { suffix: 'flac', bitRate: 900 };
  const mp3 = { suffix: 'mp3', bitRate: 320 };

  it('leaves the settings alone when the rule is off', () => {
    assert.deepEqual(transcodeTarget(mp3, 192, 'opus', false), { bitRate: 192, format: 'opus' });
  });

  it('sends lossy files as they are when it is on', () => {
    assert.deepEqual(transcodeTarget(mp3, 192, 'opus', true), { bitRate: 0, format: '' });
    assert.deepEqual(transcodeTarget(flac, 192, 'opus', true), { bitRate: 192, format: 'opus' });
  });

  it('never names a codec without a bitrate', () => {
    assert.deepEqual(transcodeTarget(flac, 0, 'opus', false), { bitRate: 0, format: '' });
  });
});
