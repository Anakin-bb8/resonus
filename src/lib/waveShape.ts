/**
 * The shape of the waveform progress bar: bar heights drawn from a song's id,
 * so the same song always looks the same (see `WaveformBar`).
 */

/** The lowest a bar gets, as a share of the height: a gap reads as missing. */
const FLOOR = 0.18;

/** A small, fast, seeded generator (mulberry32). */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h;
}

/** Bar heights between FLOOR and 1 for a song, `count` of them. */
export function waveShape(id: string, count: number): number[] {
  if (count <= 0) return [];
  const rand = seeded(hash(id));
  const raw = Array.from({ length: count }, () => rand());
  return raw.map((_, i) => {
    // Neighbours averaged, so it rises and falls instead of flickering.
    const a = raw[Math.max(0, i - 1)];
    const b = raw[i];
    const c = raw[Math.min(count - 1, i + 1)];
    const smooth = (a + 2 * b + c) / 4;
    // Quieter in the first and last few percent.
    const x = count === 1 ? 0.5 : i / (count - 1);
    const envelope = Math.min(1, x / 0.08, (1 - x) / 0.08);
    return FLOOR + (1 - FLOOR) * smooth * (0.35 + 0.65 * Math.max(0, envelope));
  });
}
