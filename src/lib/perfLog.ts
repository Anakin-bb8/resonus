/**
 * Where the JS thread goes.
 *
 * Two instruments. A heartbeat that notices when the thread was busy, by how
 * late its own timer fires, and a stopwatch around the operations we suspect.
 * Both ship in the app: a report from the phone that actually has the problem
 * beats any amount of reading the code from here (#50).
 *
 * The cost of measuring is a timer every quarter second and two `Date.now()`
 * per measured operation, so it can stay on for everyone.
 */

import { AppState } from 'react-native';

/** How often the heartbeat checks in. */
const TICK_MS = 250;
/** Under this, being late is ordinary scheduling noise rather than a block. */
const BLOCK_MS = 120;
/** Worst blocks kept. Enough to see a pattern, small enough to read. */
const MAX_BLOCKS = 15;

export interface Block {
  /** When it happened. */
  at: number;
  /** How much longer than expected the thread took to come back. */
  ms: number;
  /** What was in flight at the time, if anything. A hint, not a verdict. */
  during: string;
}

export interface OpStat {
  tag: string;
  count: number;
  totalMs: number;
  maxMs: number;
}

let startedAt = 0;
let lastTick = 0;
let timer: ReturnType<typeof setInterval> | null = null;
const blocks: Block[] = [];
const ops = new Map<string, OpStat>();
/** Operations in flight, for `during`. */
const running: string[] = [];

/**
 * Starts the heartbeat (idempotent).
 *
 * The app being in the background is not a block. Android stops handing the
 * timer its turn out there, so coming back after ten seconds away looked like a
 * ten second freeze, and those went straight to the top of the report where
 * they were the first thing anybody read. The state is watched for that reason,
 * and the tick after a return is skipped rather than blamed.
 */
export function startPerfLog(): void {
  if (timer) return;
  startedAt = Date.now();
  lastTick = Date.now();
  let awake = AppState.currentState === 'active';
  AppState.addEventListener('change', (state) => {
    awake = state === 'active';
    // Whatever happened out there is not ours to measure, and the clock starts
    // again here.
    lastTick = Date.now();
  });
  timer = setInterval(() => {
    const now = Date.now();
    const late = now - lastTick - TICK_MS;
    lastTick = now;
    if (!awake || late < BLOCK_MS) return;
    const block: Block = { at: now, ms: late, during: running[running.length - 1] ?? '—' };
    // In development it also goes to the console, where whoever is driving the
    // app can see it land on the screen that caused it.
    if (__DEV__) console.log(`[perf] BLOCK ${late} ms · during ${block.during}`);
    // The worst ones are kept, not the last ones: a single two second freeze
    // matters more than the twenty small ones that came after it.
    if (blocks.length < MAX_BLOCKS) {
      blocks.push(block);
      return;
    }
    let worstIdx = 0;
    for (let i = 1; i < blocks.length; i++) {
      if (blocks[i].ms < blocks[worstIdx].ms) worstIdx = i;
    }
    if (block.ms > blocks[worstIdx].ms) blocks[worstIdx] = block;
  }, TICK_MS);
}

/** Anything slower than this gets its own line in the development console. */
const LOUD_MS = 100;

function record(tag: string, ms: number): void {
  if (__DEV__ && ms >= LOUD_MS) console.log(`[perf] ${tag} · ${ms} ms`);
  const cur = ops.get(tag);
  if (cur) {
    cur.count++;
    cur.totalMs += ms;
    if (ms > cur.maxMs) cur.maxMs = ms;
  } else {
    ops.set(tag, { tag, count: 1, totalMs: ms, maxMs: ms });
  }
}

/**
 * Times an async operation. Note this is wall time, waiting included, so for
 * anything that goes to the network it says how long the answer took, not how
 * busy the thread was. Reading the response is timed apart, and that one IS
 * the thread.
 */
export async function timed<T>(tag: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  running.push(tag);
  try {
    return await fn();
  } finally {
    const i = running.lastIndexOf(tag);
    if (i >= 0) running.splice(i, 1);
    record(tag, Date.now() - t0);
  }
}

/** Worst blocks first. */
export function perfBlocks(): Block[] {
  return [...blocks].sort((a, b) => b.ms - a.ms);
}

/** Operations by total time spent, which is what adds up to a slow app. */
export function perfOps(): OpStat[] {
  return [...ops.values()].sort((a, b) => b.totalMs - a.totalMs);
}

export function perfSince(): number {
  return startedAt;
}

export function resetPerfLog(): void {
  blocks.length = 0;
  ops.clear();
  startedAt = Date.now();
  lastTick = Date.now();
}

/** The whole thing as text, to paste into an issue. */
export function perfReport(): string {
  const mins = Math.max(1, Math.round((Date.now() - startedAt) / 60000));
  const lines: string[] = [`Resonus diagnostics, ${mins} min of use`, ''];
  lines.push('JS thread blocks (worst first):');
  const bs = perfBlocks();
  if (bs.length === 0) lines.push('  none over 120 ms');
  for (const b of bs) lines.push(`  ${b.ms} ms · during ${b.during}`);
  lines.push('', 'Operations by total time:');
  const os = perfOps();
  if (os.length === 0) lines.push('  none measured');
  for (const o of os.slice(0, 20)) {
    lines.push(`  ${o.tag}: ${o.count}× · ${o.totalMs} ms total · ${o.maxMs} ms worst`);
  }
  return lines.join('\n');
}
