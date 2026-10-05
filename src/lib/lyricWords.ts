/**
 * Lyric lines cut into words, for the karaoke that lights them as they are
 * sung (#165). Every source hands over the same thing in its own shape: an
 * OpenSubsonic server a byte offset per word, Jellyfin a character index,
 * TTML and enhanced LRC a timestamp in the middle of the text. What they all
 * come down to is where in the line each word starts, and when.
 */
import type { LyricWord } from '@/api/subsonic';

/** Where a word starts in its line (a string index) and when it is sung. */
export interface WordMark {
  at: number;
  start: number;
  end?: number;
}

/**
 * Cuts `text` at the marks. What lies between two words goes with the first
 * (a space, usually), and anything before the first word goes with it too, so
 * the words put back together are the line exactly as it reads.
 *
 * Marks out of order or outside the line are times that cannot be trusted:
 * none come back, and the line lights up whole as it always has.
 */
export function wordsAt(text: string, marks: WordMark[]): LyricWord[] | undefined {
  if (marks.length === 0) return undefined;
  for (let i = 0; i < marks.length; i++) {
    const { at } = marks[i];
    if (at < 0 || at >= text.length || (i > 0 && at <= marks[i - 1].at)) return undefined;
  }
  return marks.map((m, i) => ({
    start: m.start,
    ...(m.end !== undefined ? { end: m.end } : {}),
    value: text.slice(i === 0 ? 0 : m.at, i + 1 < marks.length ? marks[i + 1].at : undefined),
  }));
}

/**
 * The same for marks taken before the line was trimmed, which is how the
 * timestamps inside a text come out: read with the marks in it, trimmed after.
 * A mark with nothing after it is not a word but where the last one ends, and
 * two in the same place are one word, the later.
 */
export function trimmedWords(
  raw: string,
  marks: WordMark[],
): { value: string; words?: LyricWord[] } {
  const value = raw.trim();
  const lead = raw.length - raw.trimStart().length;
  const kept: WordMark[] = [];
  let end: number | undefined;
  for (const m of marks) {
    const at = Math.max(0, m.at - lead);
    if (at >= value.length) end = m.start;
    else if (kept.length > 0 && kept[kept.length - 1].at === at) kept[kept.length - 1] = { ...m, at };
    else kept.push({ ...m, at });
  }
  const words = wordsAt(value, kept);
  if (!words) return { value };
  const last = words[words.length - 1];
  if (end !== undefined && last.end === undefined) words[words.length - 1] = { ...last, end };
  return { value, words };
}

/**
 * When each word of a line is sung out, which is what the karaoke fills on.
 *
 * The source's own end when it sent one (TTML and Jellyfin do); the next
 * word's start when it did not, since words follow one another; for the last
 * word, the next line's start - how long the phrase is held - capped, because
 * that gap is often silence rather than a note, and a word that takes four
 * seconds to fill reads as one that never does. Nothing after the word at all:
 * a guess, which is all it can be.
 *
 * `handover` is when the line stops being the one on screen, in the same
 * clock these times are read in. Nothing fills past it: a word still filling
 * when its row stops being the active one would jump to full colour (and its
 * shine disappear) in front of whoever is watching. Nor past the next word,
 * whatever the source said - fills follow one another, they do not overlap.
 */
export function wordEnds(words: LyricWord[], handover?: number): number[] {
  const gone = handover ?? Infinity;
  return words.map((w, i) => {
    const next = words[i + 1]?.start;
    const until =
      next !== undefined
        ? Math.min(w.end ?? next, next)
        : (w.end ?? Math.min(gone, w.start + HELD_LIMIT_MS));
    return Math.max(Math.min(until, gone), w.start);
  });
}

/** The most the last word fills for when nothing says when it ends. */
const HELD_LIMIT_MS = 2500;

/**
 * The string index a UTF-8 byte offset lands on, which is what an
 * OpenSubsonic cue gives, or -1 when it falls inside a character.
 */
export function indexOfByte(text: string, byte: number): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    if (bytes === byte) return i;
    if (bytes > byte) return -1;
    const code = text.codePointAt(i)!;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    if (code > 0xffff) i++;
  }
  return -1;
}

/**
 * An OpenSubsonic cue line cut into its words (`songLyrics` version 2).
 *
 * By `byteStart`, which is what the spec fixes. A server that got the bytes
 * wrong still sent each word's text, so failing that they are looked for in
 * the line in order.
 */
export function wordsFromCues(
  text: string,
  cues: { start: number; end?: number; value?: string; byteStart?: number }[],
  offset = 0,
): LyricWord[] | undefined {
  const time = (c: { start: number; end?: number }) => ({
    start: Math.max(0, c.start - offset),
    ...(c.end !== undefined ? { end: Math.max(0, c.end - offset) } : {}),
  });
  const byBytes = wordsAt(
    text,
    cues.map((c) => ({
      at: c.byteStart === undefined ? -1 : indexOfByte(text, c.byteStart),
      ...time(c),
    })),
  );
  if (byBytes) return byBytes;
  let from = 0;
  return wordsAt(
    text,
    cues.map((c) => {
      const at = c.value ? text.indexOf(c.value, from) : -1;
      if (at >= 0) from = at + c.value!.length;
      return { at, ...time(c) };
    }),
  );
}
