/**
 * Where the phone's own sound is going, from the local `AudioRoute` module.
 * A build without it (Expo Go, an older binary) reports nothing and the
 * devices button stays as it was.
 */
import { requireOptionalNativeModule } from 'expo-modules-core';

import { normalizeRoute, type AudioRoute } from './audioRouteTypes';

type RawRoute = { kind?: unknown; name?: unknown };

const native = requireOptionalNativeModule<{
  getRoute: () => RawRoute | null;
  addListener: (event: 'routeChanged', listener: (route: RawRoute) => void) => { remove: () => void };
}>('AudioRoute');

/** The current route, or null when there is no module to ask. */
export function getAudioRoute(): AudioRoute | null {
  if (!native) return null;
  try {
    return normalizeRoute(native.getRoute());
  } catch {
    return null;
  }
}

/** Calls back on every plug, pairing and handoff. Returns the unsubscribe. */
export function subscribeAudioRoute(onRoute: (route: AudioRoute | null) => void): () => void {
  if (!native) return () => {};
  try {
    const sub = native.addListener('routeChanged', (raw) => onRoute(normalizeRoute(raw)));
    return () => sub.remove();
  } catch {
    return () => {};
  }
}
