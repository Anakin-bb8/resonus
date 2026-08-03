/**
 * Work that can wait for the thread to be free.
 *
 * This used to be `InteractionManager.runAfterInteractions`, which React Native
 * has deprecated in favour of `requestIdleCallback`. The idea is the same and
 * the guarantee is better: instead of "after the animations say they are done",
 * it is "when there is nothing more pressing", with a deadline so that a busy
 * app still gets round to it.
 *
 * The fallback is a plain timeout, for wherever the global is not there. Late
 * is fine; never is not, since what goes through here is bookkeeping that the
 * next screen may read.
 */

/** Longest anything waits here before it runs anyway. */
const DEADLINE_MS = 2000;

type IdleFn = (cb: () => void, options?: { timeout: number }) => unknown;

export function whenIdle(fn: () => void): void {
  const idle = (globalThis as { requestIdleCallback?: IdleFn }).requestIdleCallback;
  if (idle) idle(() => fn(), { timeout: DEADLINE_MS });
  else setTimeout(fn, 0);
}
