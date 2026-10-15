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
  getRoute: () => { kind: string; name: string; deviceClass?: string; needsPermission?: string } | null;
  requestBluetoothPermission?: () => Promise<unknown>;
  addListener: (
    event: 'routeChanged',
    listener: (route: { kind: string; name: string; deviceClass?: string; needsPermission?: string }) => void,
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

/**
 * Asks for the Bluetooth permission that names Bluetooth devices and says
 * what they are (Android 12+; older versions and iOS need nothing). True
 * when asking is pointless or the answer was yes — the caller refetches
 * either way, since even a no can change nothing but the mark.
 */
export async function requestBluetoothPermission(): Promise<boolean> {
  try {
    if (!native?.requestBluetoothPermission) return true;
    const res = (await native.requestBluetoothPermission()) as
      | boolean
      | { granted?: boolean; [permission: string]: { granted?: boolean } | boolean | undefined }
      | null
      | undefined;
    if (typeof res === 'boolean') return res;
    if (res && typeof res === 'object') {
      if (res.granted === true) return true;
      return Object.values(res).some(
        (v) => v === true || (typeof v === 'object' && v?.granted === true),
      );
    }
    return false;
  } catch {
    return false;
  }
}
