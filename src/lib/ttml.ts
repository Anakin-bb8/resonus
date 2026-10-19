/**
 * TTML lyrics: the XML Apple Music uses, and what the tools that fetch
 * word-timed lyrics save next to the music (#165). Read here for files on the
 * phone; a server reads its own and sends them already cut into words.
 *
 * Not an XML parser, which React Native has none of: the body is walked as
 * tags and text, which is all a lyrics file uses. A paragraph is a line, a
 * timed span inside it a word or a syllable, and the text between spans (a
 * space, usually) goes with the word before. A span with a role for
 * translation or romanization is not the line being sung and is left out;
 * one with `x-bg` is a backing vocal and is kept apart, under the line.
 *
 * Times are taken as they are written, from the start of the track. The spec
 * makes them relative to the parent element, but Apple's files, and so every
 * file made to look like them, repeat the absolute time on every level.
 */
import type { LyricBacking, LyricLine, SongLyrics } from '@/api/subsonic';
import { trimmedWords, type WordMark } from './lyricWords';

const TOKEN_RE =
  /<!--[\s\S]*?-->|<[?!][^>]*>|<(\/?)([A-Za-z_][\w.:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)/g;

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decode(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
    if (e[0] === '#') {
      const hex = e[1] === 'x' || e[1] === 'X';
      const code = parseInt(e.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : all;
    }
    return ENTITIES[e.toLowerCase()] ?? all;
  });
}

/** An attribute by its local name, whatever prefix it was written with. */
function attr(attrs: string, name: string): string | undefined {
  const m = attrs.match(new RegExp(`(?:^|\\s)(?:[\\w.-]+:)?${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`));
  return m ? (m[1] ?? m[2]) : undefined;
}

const UNIT_MS: Record<string, number> = { h: 3_600_000, m: 60_000, s: 1000, ms: 1 };

/** A clock time (`1:02.5`, `00:01:02.500`) or an offset (`62.5s`, `1500ms`), in ms. */
export function ttmlTime(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const v = value.trim();
  const offset = v.match(/^(\d+(?:\.\d+)?)(h|m|s|ms)$/);
  if (offset) return Math.round(parseFloat(offset[1]) * UNIT_MS[offset[2]]);
  const parts = v.split(':');
  if (parts.length > 3 || !parts.every((p) => /^\d+(?:\.\d+)?$/.test(p))) return undefined;
  let sec = 0;
  for (const p of parts) sec = sec * 60 + parseFloat(p);
  return Math.round(sec * 1000);
}

export function parseTtml(text: string): SongLyrics | null {
  const body = text.search(/<(?:[\w.-]+:)?body[\s>/]/);
  if (body < 0) return null;
  const lines: LyricLine[] = [];
  interface BackingDraft {
    start?: number;
    raw: string;
    marks: WordMark[];
  }
  let line: { start?: number; raw: string; marks: WordMark[]; backing: LyricBacking[] } | null =
    null;
  /**
   * One per open span: whether what is inside it is left out, or collected
   * as the backing vocal it belongs to.
   */
  let spans: { skip: boolean; bg: BackingDraft | null }[] = [];
  const skipped = () => spans.some((s) => s.skip);
  /** The innermost backing vocal collecting text, if inside one. */
  const openBg = (): BackingDraft | null => {
    for (let i = spans.length - 1; i >= 0; i--) if (spans[i].bg) return spans[i].bg;
    return null;
  };

  const finishBacking = (seg: BackingDraft): LyricBacking | null => {
    const { value, words } = trimmedWords(seg.raw, seg.marks);
    if (!value) return null;
    const start = seg.start ?? words?.[0].start;
    if (start === undefined) return null;
    const end = words?.length ? words[words.length - 1].end : undefined;
    return { start, ...(end !== undefined ? { end } : {}), value, ...(words ? { words } : {}) };
  };

  const finish = (l: { start?: number; raw: string; marks: WordMark[]; backing: LyricBacking[] }) => {
    const { value, words } = trimmedWords(l.raw, l.marks);
    if (!value) return;
    const start = l.start ?? words?.[0].start;
    lines.push({
      ...(start !== undefined ? { start } : {}),
      value,
      ...(words ? { words } : {}),
      ...(l.backing.length > 0 ? { backing: l.backing } : {}),
      // The first content of a later `div` (a new song part) opens a stanza.
      // A dropped (empty) line does not consume it: the stanza still starts at
      // whatever is sung next.
      ...(stanzaArmed && lines.length > 0 ? { newStanza: true } : {}),
    });
    stanzaArmed = false;
  };
  /** Set on every `div` after the first: its first sung line opens a stanza. */
  let stanzaArmed = false;
  let divSeen = false;

  for (const m of text.slice(body).matchAll(TOKEN_RE)) {
    const [, slash, tag, attrs = '', content] = m;
    if (content !== undefined) {
      // XML folds any run of white space into one, newlines of an indented
      // file included.
      if (line && !skipped()) (openBg() ?? line).raw += decode(content.replace(/\s+/g, ' '));
      continue;
    }
    if (!tag) continue; // a comment or a declaration
    const name = tag.replace(/^.*:/, '');
    const empty = attrs.endsWith('/');
    if (name === 'div') {
      if (!slash && !empty) {
        if (divSeen) stanzaArmed = true;
        divSeen = true;
      }
    } else if (name === 'p') {
      if (slash) {
        if (line) finish(line);
        line = null;
        spans = [];
      } else if (!empty) {
        line = { start: ttmlTime(attr(attrs, 'begin')), raw: '', marks: [], backing: [] };
      }
    } else if (name === 'span' && line) {
      if (slash) {
        const top = spans.pop();
        if (top?.bg) {
          const done = finishBacking(top.bg);
          if (done) line.backing.push(done);
        }
      } else if (!empty) {
        const role = attr(attrs, 'role');
        if (role === 'x-bg' && !skipped()) {
          // A backing vocal: collected apart, under the lead line.
          const begin = ttmlTime(attr(attrs, 'begin'));
          const seg: BackingDraft = {
            ...(begin !== undefined ? { start: begin } : {}),
            raw: '',
            marks: [],
          };
          if (begin !== undefined) {
            const end = ttmlTime(attr(attrs, 'end'));
            seg.marks.push({ at: 0, start: begin, ...(end !== undefined ? { end } : {}) });
          }
          spans.push({ skip: false, bg: seg });
        } else {
          const skip = skipped() || role !== undefined;
          spans.push({ skip, bg: null });
          const begin = skip ? undefined : ttmlTime(attr(attrs, 'begin'));
          if (begin !== undefined) {
            const end = ttmlTime(attr(attrs, 'end'));
            const mark = { at: 0, start: begin, ...(end !== undefined ? { end } : {}) };
            const target = openBg();
            if (target) {
              target.marks.push({ ...mark, at: target.raw.length });
            } else {
              line.marks.push({ ...mark, at: line.raw.length });
            }
          }
        }
      }
    } else if (name === 'br' && line && !skipped()) {
      (openBg() ?? line).raw += ' ';
    }
  }

  if (lines.length === 0) return null;
  if (!lines.some((l) => l.start !== undefined)) return { synced: false, lines };
  // A line with no time of its own keeps the place of the one before it.
  let prev = 0;
  const timed = lines.map((l) => {
    prev = l.start ?? prev;
    return { ...l, start: prev };
  });
  timed.sort((a, b) => a.start - b.start);
  return { synced: true, lines: timed };
}
