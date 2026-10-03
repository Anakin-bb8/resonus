/** Which artists a song lets you go to. */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { artistTargets } from '@/lib/artistNav';

const ids = (list: { id: string }[]) => list.map((a) => a.id);

describe('artistTargets', () => {
  it('adds remixers after the artists, once', () => {
    const song = {
      artists: [{ id: 'a', name: 'A' }],
      contributors: [
        { role: 'remixer', artist: { id: 'r', name: 'R' } },
        { role: 'remixer', artist: { id: 'a', name: 'A' } },
        { role: 'composer', artist: { id: 'c', name: 'C' } },
      ],
    };
    assert.deepEqual(ids(artistTargets(song)), ['a', 'r']);
  });

  it('falls back to artistId when the list has no usable ids', () => {
    const song = { artist: 'A', artistId: 'a', artists: [{ id: '', name: 'A' }] };
    assert.deepEqual(ids(artistTargets(song)), ['a']);
  });

  it('keeps a remixer even without any artist', () => {
    const song = { contributors: [{ role: 'remixer', artist: { id: 'r', name: 'R' } }] };
    assert.deepEqual(ids(artistTargets(song)), ['r']);
  });
});
