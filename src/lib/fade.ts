/**
 * The gradients that run one colour into the page's own, eased rather than
 * straight: a straight blend has a visible corner where it starts and a line
 * where it lands — the stacco at the end of the top bar's fade. Smoothstep
 * eases in and out of both, over several stops, since the gradient itself
 * only blends in straight lines between them.
 *
 * The first quarter of the run holds `from` flat — the header keeps its
 * colour under the title before letting go — and the last stop is `to`,
 * with the slope arriving there already zero, so the flat run begins
 * without an edge to find.
 */

/** How much of the run holds the first colour before starting to let go. */
const HOLD = 0.25;
const STEPS = 8;

export interface Fade {
  colors: [string, string, ...string[]];
  locations: [number, number, ...number[]];
}

export function easedFade(from: string, to: string): Fade {
  const a = hexChannels(from);
  const b = hexChannels(to);
  if (!a || !b) return { colors: [from, from, to], locations: [0, HOLD, 1] };

  const colors: string[] = [from, from];
  const locations: number[] = [0, HOLD];
  for (let i = 1; i <= STEPS; i++) {
    const u = i / STEPS;
    const k = u * u * (3 - 2 * u);
    colors.push(`rgb(${a.map((c, j) => Math.round(c + (b[j] - c) * k)).join(', ')})`);
    locations.push(HOLD + (1 - HOLD) * u);
  }

  return { colors: colors as Fade['colors'], locations: locations as Fade['locations'] };
}

function hexChannels(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
