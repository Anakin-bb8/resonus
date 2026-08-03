/**
 * The one place that can say no to a request.
 *
 * Offline mode used to be a rule repeated at every call site: each function in
 * `data.ts` asked whether it was offline and went to the local copy instead. It
 * only holds for as long as nobody forgets, and something always does — a
 * background sync, a probe on a timer, a cover URL handed to the image loader.
 * Any of them was a packet leaving a phone whose owner had said not to use the
 * network, which is not a small thing when they said it because the data costs
 * them money.
 *
 * So the rule lives here instead, under the layer that makes requests rather
 * than on top of it: while offline mode is on, every request through the API
 * fails before reaching `fetch`. Forgetting a check upstream is then a bug that
 * shows itself, not a bug that quietly uses somebody's data.
 *
 * Two things are still allowed through, and both are asked for explicitly:
 * `ping`, which is how the app finds out the server is back and is the only way
 * out of an automatic offline, and anything the person taps to say "try now".
 * Everything else waits until they are online.
 *
 * This module knows nothing about the store on purpose: the auth store pushes
 * the mode in (see its subscription), so the API layer keeps no dependency on
 * anything above it.
 */

/**
 * Closed until the saved mode has been read off disk. Starting open is what
 * makes a cold start leak: hydrating takes a moment, and that moment is
 * precisely when the app does the most asking. Better to refuse a request that
 * would have been fine than to make one that should never have left.
 */
let offline = true;

/** Thrown instead of making the request. Reads as a network error, because to
 *  everything upstream that is exactly what it is: the server is unreachable. */
export class OfflineError extends Error {
  network = true;
  constructor() {
    super('Offline mode: no requests are made');
    this.name = 'OfflineError';
  }
}

/** Called by the auth store whenever the mode changes. */
export function setOfflineMode(value: boolean): void {
  offline = value;
}

export function isOfflineMode(): boolean {
  return offline;
}

/**
 * Refuses the request when offline. `allowOffline` is for the few calls that
 * exist precisely to find out whether the server is there.
 */
export function assertCanRequest(allowOffline = false): void {
  if (offline && !allowOffline) throw new OfflineError();
}
