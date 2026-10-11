/**
 * Where the sound is going, from the local `AudioRoute` module when the build
 * has it (dev builds; Expo Go has no such module and reports nothing).
 *
 * Only the route kind drives the UI: Bluetooth and wired outputs get their
 * icon and, with the setting on, their name. The phone speaker and anything
 * unknown read as no device at all.
 */
import { requireOptionalNativeModule } from 'expo-modules-core';

import { normalizeRoute, type AudioRoute } from './audioRouteTypes';

interface NativeAudioRoute {
  getRoute: () => { kind: string; name: string } | null;
  addListener: (
    event: 'routeChanged',
    listener: (route: { kind: string; name: string }) => void,
  ) => { remove: () => void };
}

// Optional: a build without the module simply has no route to report.
const native = requireOptionalNativeModule<NativeAudioRoute>('AudioRoute');

/** The current route, or null when nobody knows (no module, no permission). */
export function getAudioRoute(): AudioRoute | null {
  try {
    return normalizeRoute(native?.getRoute());
  } catch {
    return null;
  }
}

/** Calls back on every plug, pairing and handoff. Returns the unsubscribe. */
export function subscribeAudioRoute(
  onRoute: (route: AudioRoute | null) => void,
): (() => void) | undefined {
  try {
    const sub = native?.addListener('routeChanged', (raw) => onRoute(normalizeRoute(raw)));
    return sub ? () => sub.remove() : undefined;
  } catch {
    return undefined;
  }
}
