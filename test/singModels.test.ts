/** The pinned karaoke voice-model metadata (sizes, hashes, labels). */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  SING_MODELS,
  singModelSizeLabel,
  singModelTotalBytes,
  type SingModelKind,
} from '@/lib/singModels';

const KINDS: SingModelKind[] = ['full', 'light'];

describe('sing model metadata', () => {
  it('has the same five-file shape for both models', () => {
    for (const kind of KINDS) {
      assert.equal(SING_MODELS[kind].files.length, 5);
      assert.ok(SING_MODELS[kind].repoFolder.endsWith('.mlmodelc'));
    }
  });

  it('pins every file with a 64-character hex hash and a positive size', () => {
    for (const kind of KINDS) {
      for (const file of SING_MODELS[kind].files) {
        assert.match(file.sha256, /^[0-9a-f]{64}$/);
        assert.ok(file.size > 0);
      }
    }
  });

  it('adds the sizes up to the published totals', () => {
    // Full ≈ 210 MB, light ≈ 31 MB, as Taurus's own manifest sums them.
    assert.equal(singModelTotalBytes('full'), 210_426_814);
    assert.equal(singModelTotalBytes('light'), 30_760_023);
  });

  it('labels the models the way the settings row shows them', () => {
    assert.equal(singModelSizeLabel('full'), '210 MB');
    assert.equal(singModelSizeLabel('light'), '31 MB');
  });
});
