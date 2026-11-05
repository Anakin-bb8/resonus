/**
 * The phone's own output as both native sides describe it, and what the
 * player makes of it. Pure on purpose: the native binding lives in
 * `audioRoute`, which the node tests cannot import.
 */

export type AudioRouteKind = 'builtin' | 'wired' | 'bluetooth' | 'car' | 'airplay' | 'other';

export interface AudioRoute {
  kind: AudioRouteKind;
  /** The system's name for it ("AirPods Pro"); empty when it gives none. */
  name: string;
}

const KINDS = new Set<string>(['builtin', 'wired', 'bluetooth', 'car', 'airplay', 'other']);

/** A raw native answer cut down to what the UI may trust. */
export function normalizeRoute(
  raw: { kind?: unknown; name?: unknown } | null | undefined,
): AudioRoute | null {
  if (!raw || typeof raw.kind !== 'string' || !KINDS.has(raw.kind)) return null;
  return {
    kind: raw.kind as AudioRouteKind,
    name: typeof raw.name === 'string' ? raw.name.trim() : '',
  };
}

export function sameRoute(a: AudioRoute | null, b: AudioRoute | null): boolean {
  return a === b || (!!a && !!b && a.kind === b.kind && a.name === b.name);
}

/**
 * How the devices button shows a route worth naming: its icon and the label
 * to fall back on when the system gives no name (an i18n key). Null for the
 * phone's speaker and anything unknown, which keep the plain button.
 */
export function routeLook(
  kind: AudioRouteKind,
): { icon: 'bluetooth' | 'headset-outline' | 'car-outline' | 'tv-outline'; fallback: string } | null {
  switch (kind) {
    case 'bluetooth':
      return { icon: 'bluetooth', fallback: 'Bluetooth' };
    case 'wired':
      return { icon: 'headset-outline', fallback: 'Headphones' };
    case 'car':
      return { icon: 'car-outline', fallback: 'Car' };
    case 'airplay':
      return { icon: 'tv-outline', fallback: 'AirPlay' };
    default:
      return null;
  }
}
