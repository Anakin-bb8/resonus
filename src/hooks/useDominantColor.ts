/**
 * Extracts a background color from the cover art (dominant color) and
 * normalizes it to a pleasant dark tone: saturation is clamped (to avoid neon)
 * and lightness is clamped to a medium-dark range, so that white text and
 * controls are always legible regardless of the cover art. This is what
 * Spotify/Apple Music do with the cover color.
 */
import { useEffect, useState } from 'react';
import { getColors } from 'react-native-image-colors';

import { colors as theme } from '@/theme';

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  let r: number;
  let g: number;
  let b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hue = (t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    r = hue(h + 1 / 3);
    g = hue(h);
    b = hue(h - 1 / 3);
  }
  const to = (x: number) =>
    Math.round(x * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

/** Clamps saturation and lightness to a readable dark range. */
function normalize(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const [h, s, l] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  return hslToHex(h, Math.min(s, 0.55), Math.min(Math.max(l, 0.2), 0.32));
}

/**
 * Size asked for when the image is only going to be reduced to one colour.
 *
 * `getColors` downloads on its own — it doesn't share expo-image's cache — so
 * asking for the same 500 or 600 px the screen is already showing meant
 * fetching every cover twice at full size. A small copy quantizes to the same
 * colour for a fraction of the bytes.
 *
 * It's also one single size across the app: the player and the mini player had
 * to agree on one already, or the same song came out two different colours on
 * two screens. Now everything reads the same pixels.
 */
const PALETTE_SIZE = 200;

/** The same cover, small, when it's a server cover URL — Subsonic asks for
 *  `size`, Jellyfin for `fillWidth`/`fillHeight`. Anything else (local files,
 *  radio art) is left exactly as it is. */
function paletteUri(uri: string): string {
  return uri.replace(/([?&](?:size|fillWidth|fillHeight)=)\d+/g, `$1${PALETTE_SIZE}`);
}

export function useDominantColor(uri?: string): string {
  const [color, setColor] = useState<string>(theme.surfaceHighlight);

  useEffect(() => {
    let active = true;
    if (!uri) {
      setColor(theme.surfaceHighlight);
      return;
    }
    const src = paletteUri(uri);
    // Keyed by the small URL: two screens showing the same cover at different
    // sizes now share one cached palette.
    getColors(src, { fallback: theme.surfaceHighlight, cache: true, key: src })
      .then((res) => {
        if (!active) return;
        let c: string = theme.surfaceHighlight;
        // Prefer a vibrant tone and darken it in `normalize`; this preserves
        // the character of the cover art without looking dull or too bright.
        if (res.platform === 'android') {
          c = res.vibrant || res.darkVibrant || res.muted || res.dominant || c;
        } else if (res.platform === 'ios') {
          c = res.background || res.primary || res.secondary || c;
        } else if (res.platform === 'web') {
          c = res.vibrant || res.darkVibrant || res.dominant || c;
        }
        setColor(normalize(c));
      })
      .catch(() => {
        if (active) setColor(theme.surfaceHighlight);
      });
    return () => {
      active = false;
    };
  }, [uri]);

  return color;
}
