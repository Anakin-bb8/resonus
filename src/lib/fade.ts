/**
 * The gradients that run one colour into the page's own, eased rather than
 * straight: a straight blend has a visible corner where it starts and a line
 * where it lands — the stacco at the end of the top bar's fade. Smoothstep
 * eases in and out of both, over several stops, since the gradient itself
 * only blends in straight lines between them.
 *
 * `start` is how much of the run holds `from` (the header keeps its colour
 * under the title before letting go), `until` where `to` arrives. What
 * follows is `to` flat, and the slope arriving there is zero, so the flat run
 * begins without an edge to find.
 */

export interface Fade {
  colors: [string, string, ...string[]];
  locations: [number, number, ...number[]];
}

export function easedFade(
  from: string,
  to: string,
  { start = 0.25, until = 1, steps = 8 }: { start?: number; until?: number; steps?: number } = {},
): Fade {
  const a = hexChannels(from);
  const b = hexChannels(to);
  if (!a || !b) {
    return start > 0
      ? { colors: [from, from, to], locations: [0, start, until] }
      : { colors: [from, to], locations: [0, until] };
  }

  const colors: string[] = [from];
  const locations: number[] = [0];
  if (start > 0) {
    colors.push(from);
    locations.push(start);
  }
  for (let i = 1; i <= steps; i++) {
    const u = i / steps;
    const k = u * u * (3 - 2 * u);
    colors.push(`rgb(${a.map((c, j) => Math.round(c + (b[j] - c) * k)).join(', ')})`);
    locations.push(start + (until - start) * u);
  }
  // Said out loud rather than left to the last stop being clamped: the flat
  // run is the point of landing early, and it should be in the data.
  if (until < 1) {
    colors.push(to);
    locations.push(1);
  }

  return { colors: colors as Fade['colors'], locations: locations as Fade['locations'] };
}

function hexChannels(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
