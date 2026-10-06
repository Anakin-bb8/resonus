/**
 * The gradients that run one colour into the page's own, eased rather than
 * straight: a straight blend has a visible corner where it starts and a line
 * where it lands - the stacco at the end of the top bar's fade. Smoothstep
 * eases in and out of both, over several stops, since the gradient itself
 * only blends in straight lines between them.
 *
 * The first quarter of the run holds `from` flat - the header keeps its
 * colour under the title before letting go - and `to` arrives at `until`
 * with the slope there already zero, so what follows is a flat run in the
 * page's own colour that begins without an edge to find.
 */

/** How much of the run holds the first colour before starting to let go. */
const HOLD = 0.25;
const STEPS = 12;

export interface Fade {
  colors: [string, string, ...string[]];
  locations: [number, number, ...number[]];
}

/** `until` is where the second colour is fully arrived: before the end, the
 *  rest of the run is the page's own colour, held flat. */
export function easedFade(
  from: string,
  to: string,
  { until = 1 }: { until?: number } = {},
): Fade {
  const end = Math.min(Math.max(until, HOLD + 0.05), 1);
  const a = hexChannels(from);
  const b = hexChannels(to);
  if (!a || !b) return { colors: [from, from, to], locations: [0, HOLD, end] };

  const colors: string[] = [from, from];
  const locations: number[] = [0, HOLD];
  for (let i = 1; i <= STEPS; i++) {
    const u = i / STEPS;
    const k = u * u * (3 - 2 * u);
    const mix = a.map((c, j) => Math.round(c + (b[j] - c) * k));
    colors.push(`rgb(${mix.join(', ')})`);
    locations.push(HOLD + (end - HOLD) * u);
  }

  return { colors: colors as Fade['colors'], locations: locations as Fade['locations'] };
}

function hexChannels(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
