/**
 * Audio route mapping: native answers cut down to what the UI may trust, and
 * device kinds to their button icon.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { normalizeRoute, routeIcon } from '@/lib/audioRouteTypes';

describe('normalizeRoute', () => {
  it('keeps known kinds with their name', () => {
    assert.deepEqual(normalizeRoute({ kind: 'bluetooth', name: 'AirPods' }), {
      kind: 'bluetooth',
      name: 'AirPods',
    });
  });

  it('drops unknown kinds and missing answers', () => {
    assert.equal(normalizeRoute({ kind: 'telepathy', name: 'X' }), null);
    assert.equal(normalizeRoute(null), null);
    assert.equal(normalizeRoute(undefined), null);
  });

  it('reads a missing name as empty, never as undefined', () => {
    assert.deepEqual(normalizeRoute({ kind: 'wired', name: undefined as never }), {
      kind: 'wired',
      name: '',
    });
  });
});

describe('routeIcon', () => {
  it('names an icon per device kind, default for the rest', () => {
    assert.equal(routeIcon('bluetooth'), 'bluetooth');
    assert.equal(routeIcon('wired'), 'headset-outline');
    assert.equal(routeIcon('car'), 'car');
    assert.equal(routeIcon('airplay'), 'tv');
    assert.equal(routeIcon('builtin'), undefined);
    assert.equal(routeIcon('other'), undefined);
  });
});
