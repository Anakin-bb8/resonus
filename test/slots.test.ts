/** The request slots (src/lib/slots.ts). */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createSlots } from '@/lib/slots';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('createSlots', () => {
  it('lets the first ones through and holds the rest', async () => {
    const slots = createSlots(2);
    const started: number[] = [];
    for (const n of [1, 2, 3]) void slots.take().then(() => started.push(n));
    await tick();
    assert.deepEqual(started, [1, 2]);
    slots.release();
    await tick();
    assert.deepEqual(started, [1, 2, 3]);
  });

  it('never lets a newcomer cut in when a slot is freed', async () => {
    const slots = createSlots(1);
    const started: string[] = [];
    await slots.take();
    void slots.take().then(() => started.push('waiting'));
    slots.release();
    void slots.take().then(() => started.push('newcomer'));
    await tick();
    assert.deepEqual(started, ['waiting']);
  });
});
