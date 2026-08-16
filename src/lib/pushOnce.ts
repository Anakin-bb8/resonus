/**
 * A push that ignores itself when it arrives twice in a row.
 *
 * A tap only becomes a screen once the navigation state is committed, so two
 * quick taps on the mini player are two pushes decided against the same state
 * and the stack ends up with two players: you close one and there is another
 * behind it (#148).
 *
 * This is the second answer to that. The first was `dangerouslySingular` on the
 * route, which asks the router to keep one screen per name, and the router
 * honours it by taking the existing route out of the middle of the stack and
 * pushing it again on the end with the same key. react-native-screens does not
 * survive that reorder: the top Screen comes back with nothing in it, and on a
 * transparent modal like the player that means an invisible sheet over the app
 * eating every touch. It froze the app twice, from two different directions,
 * before it was taken off the last three routes that had it (#148 and the one
 * after it; the root layout tells both stories).
 *
 * A debounce cannot do that, because it never touches the stack: the second tap
 * is simply not a navigation. It is what React Navigation recommends for this,
 * and the whole of it is below.
 *
 * Not on every push in the app. It is for the handful of places that open a
 * screen you cannot get back to a second time by accident, which is where a
 * duplicate is worth the guard; a row in a list is one back press away.
 */
import { router } from 'expo-router';

/**
 * Long enough to cover the gap between a tap and the state it decides, short
 * enough that a deliberate second visit still goes through. The screens this
 * guards animate in over about that long, and once one is up the thing that
 * opened it is behind it and cannot be tapped again.
 */
const WINDOW_MS = 600;

let lastHref = '';
let lastAt = 0;

export function pushOnce(href: string): void {
  const now = Date.now();
  if (href === lastHref && now - lastAt < WINDOW_MS) return;
  lastHref = href;
  lastAt = now;
  router.push(href as never);
}
