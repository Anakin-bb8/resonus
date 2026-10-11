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
}

const KINDS = new Set<string>(['builtin', 'wired', 'bluetooth', 'car', 'airplay', 'other']);

/** A raw native answer cut down to what the UI may trust. */
export function normalizeRoute(raw: { kind: string; name: string } | null | undefined): AudioRoute | null {
  if (!raw || !KINDS.has(raw.kind)) return null;
  return { kind: raw.kind as AudioRouteKind, name: typeof raw.name === 'string' ? raw.name : '' };
}

/**
 * The devices-button icon for a route, or undefined for the default one.
 * Ionicons names (drawn by Ionicons itself when the Phosphor map has no
 * entry); wired outputs read as the mapped headset glyph.
 */
export function routeIcon(kind: AudioRouteKind): 'bluetooth' | 'headset-outline' | 'car' | 'tv' | undefined {
  if (kind === 'bluetooth') return 'bluetooth';
  if (kind === 'wired') return 'headset-outline';
  if (kind === 'car') return 'car';
  if (kind === 'airplay') return 'tv';
  return undefined;
}
