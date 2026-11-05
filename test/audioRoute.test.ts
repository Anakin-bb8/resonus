/**
 * The phone's output: native answers cut down to what the UI may trust, and
 * which kinds the devices button names.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { normalizeRoute, routeLook, sameRoute } from '@/lib/audioRouteTypes';

describe('normalizeRoute', () => {
  it('keeps a known kind with its name, trimmed', () => {
    assert.deepEqual(normalizeRoute({ kind: 'bluetooth', name: ' Pixel Buds ' }), {
      kind: 'bluetooth',
      name: 'Pixel Buds',
    });
  });

  it('drops unknown kinds and missing answers', () => {
    assert.equal(normalizeRoute({ kind: 'telepathy', name: 'X' }), null);
    assert.equal(normalizeRoute(null), null);
    assert.equal(normalizeRoute(undefined), null);
  });

  it('reads a missing name as empty', () => {
    assert.deepEqual(normalizeRoute({ kind: 'wired' }), { kind: 'wired', name: '' });
  });
});

describe('sameRoute', () => {
  it('compares kind and name', () => {
    assert.ok(sameRoute({ kind: 'wired', name: 'A' }, { kind: 'wired', name: 'A' }));
    assert.ok(!sameRoute({ kind: 'wired', name: 'A' }, { kind: 'wired', name: 'B' }));
    assert.ok(!sameRoute(null, { kind: 'builtin', name: '' }));
    assert.ok(sameRoute(null, null));
  });
});

describe('routeLook', () => {
  it('names headsets, the car and AirPlay, not the speaker', () => {
    assert.equal(routeLook('bluetooth')?.icon, 'bluetooth');
    assert.equal(routeLook('wired')?.fallback, 'Headphones');
    assert.equal(routeLook('car')?.icon, 'car-outline');
    assert.equal(routeLook('airplay')?.icon, 'tv-outline');
    assert.equal(routeLook('builtin'), null);
    assert.equal(routeLook('other'), null);
  });
});
