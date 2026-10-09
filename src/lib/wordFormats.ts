/**
 * Word-by-word lyric shapes, normalized. Every online source hands over the
 * same thing in its own format: BiniLyrics and Unison serve Apple TTML (read
 * by `parseTtml`), LyricsPlus answers JSON with words and their times. What
 * they come down to is `SongLyrics`, lines with words that know when they
 * start.
 */
import type { LyricLine, LyricWord, SongLyrics } from '@/api/subsonic';

interface BiniResult {
  timing_type?: string;
  lyricsUrl?: string;
}

/** Word-timed result first, then anything with lyrics at all. */
export function pickBiniLyricsUrl(results: unknown): string | null {
  if (!Array.isArray(results)) return null;
  const rows = results.filter(
    (r): r is BiniResult => !!r && typeof r === 'object' && typeof (r as BiniResult).lyricsUrl === 'string',
  );
  return (
    rows.find((r) => r.timing_type === 'word')?.lyricsUrl ??
    rows[0]?.lyricsUrl ??
    null
  );
}

interface KpoeSyllable {
  time?: number;
  duration?: number;
  text?: string;
}

interface KpoeLine {
  time?: number;
  duration?: number;
  text?: string;
  syllabus?: KpoeSyllable[];
}

/** The LyricsPlus v2 JSON onto lines and words. Line-level answers come back wordless. */
export function kpoeToLyrics(res: unknown): SongLyrics | null {
  if (!res || typeof res !== 'object') return null;
  const raw = (res as { lyrics?: unknown }).lyrics;
  if (!Array.isArray(raw)) return null;
  const num = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  const lines: LyricLine[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const { time, text, syllabus } = entry as KpoeLine;
    const start = num(time);
    const words: LyricWord[] = [];
    if (Array.isArray(syllabus)) {
      for (const s of syllabus) {
        if (!s || typeof s !== 'object') continue;
        const wStart = num((s as KpoeSyllable).time);
        const wText = typeof (s as KpoeSyllable).text === 'string' ? (s as KpoeSyllable).text! : '';
        if (wStart === undefined || !wText) continue;
        const dur = num((s as KpoeSyllable).duration);
        words.push({ start: wStart, ...(dur !== undefined ? { end: wStart + dur } : {}), value: wText });
      }
    }
    // The syllables put back together are the line: reading the line's own
    // text instead would split spacing from timing on joins that differ.
    const value = words.length > 0 ? words.map((w) => w.value).join('').trim() : typeof text === 'string' ? text.trim() : '';
    if (!value) continue;
    lines.push({ ...(start !== undefined ? { start } : {}), value, ...(words.length > 0 ? { words } : {}) });
  }
  if (lines.length === 0) return null;
  if (!lines.some((l) => l.start !== undefined)) return { synced: false, lines };
  return { synced: true, lines };
}
