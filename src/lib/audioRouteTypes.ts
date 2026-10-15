/**
 * Audio route kinds both native sides agree on, and what the UI makes of
 * them. Pure on purpose: the native binding lives in `audioRoute`, which the
 * node tests cannot import.
 */

/** Device kinds both native sides agree on. */
export type AudioRouteKind = 'builtin' | 'wired' | 'bluetooth' | 'car' | 'airplay' | 'other';

export interface AudioRoute {
  kind: AudioRouteKind;
  /** The system's name for it ("AirPods Pro"); empty when withheld. */
  name: string;
  /** What a Bluetooth device is, when the OS said (Android with permission). */
  deviceClass?: 'headphones' | 'speaker' | 'car' | null;
  /** The class is knowable but the permission is missing (Android 12+). */
  needsPermission?: boolean;
}

const KINDS = new Set<string>(['builtin', 'wired', 'bluetooth', 'car', 'airplay', 'other']);
const CLASSES = new Set<string>(['headphones', 'speaker', 'car']);

/** A raw native answer cut down to what the UI may trust. */
export function normalizeRoute(
  raw: { kind: string; name: string; deviceClass?: string; needsPermission?: string } | null | undefined,
): AudioRoute | null {
  if (!raw || !KINDS.has(raw.kind)) return null;
  const deviceClass = raw.deviceClass && CLASSES.has(raw.deviceClass) ? raw.deviceClass : null;
  return {
    kind: raw.kind as AudioRouteKind,
    name: typeof raw.name === 'string' ? raw.name : '',
    ...(deviceClass
      ? { deviceClass: deviceClass as NonNullable<AudioRoute['deviceClass']> }
      : {}),
    ...(raw.needsPermission === 'true' ? { needsPermission: true } : {}),
  };
}

/**
 * The devices-button icon for a route, or undefined for the default one.
 * Ionicons names (drawn by Ionicons itself when the Phosphor map has no
 * entry); wired outputs read as the mapped headset glyph, and a Bluetooth
 * device the OS placed reads as what it is.
 */
export function routeIcon(
  kind: AudioRouteKind,
  deviceClass?: 'headphones' | 'speaker' | 'car' | null,
): 'bluetooth' | 'headset-outline' | 'volume-high-outline' | 'car' | 'tv' | undefined {
  if (kind === 'bluetooth' && deviceClass) {
    if (deviceClass === 'headphones') return 'headset-outline';
    if (deviceClass === 'speaker') return 'volume-high-outline';
    return 'car';
  }
  if (kind === 'bluetooth') return 'bluetooth';
  if (kind === 'wired') return 'headset-outline';
  if (kind === 'car') return 'car';
  if (kind === 'airplay') return 'tv';
  return undefined;
}
