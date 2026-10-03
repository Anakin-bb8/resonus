/**
 * The notes of a release, cut down to what fits in the update prompt.
 *
 * The release body is the CHANGELOG section for that version: `### Added`,
 * `### Changed`, `### Fixed` (and the odd `### Removed`), one plain sentence
 * per bullet. Anything that is not one of those headings or a bullet under one
 * is ignored, so a release written by hand degrades to no summary rather than
 * to a wrong one.
 */

export type NoteKind = 'added' | 'changed' | 'fixed';

export type ReleaseNotes = Record<NoteKind, string[]>;

const HEADINGS: Record<string, NoteKind> = {
  added: 'added',
  changed: 'changed',
  removed: 'changed',
  deprecated: 'changed',
  fixed: 'fixed',
  security: 'fixed',
};

/** Markdown down to the words: links keep their text, issue numbers go. */
function plain(line: string): string {
  return line
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/\s*\((?:#\d+(?:,\s*)?)+\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseReleaseNotes(body: string | undefined | null): ReleaseNotes | undefined {
  if (!body) return undefined;
  const notes: ReleaseNotes = { added: [], changed: [], fixed: [] };
  let kind: NoteKind | null = null;
  for (const raw of body.split(/\r?\n/)) {
    const heading = /^#{2,4}\s+(.+)$/.exec(raw.trim());
    if (heading) {
      kind = HEADINGS[plain(heading[1]).toLowerCase()] ?? null;
      continue;
    }
    const bullet = /^[-*]\s+(.+)$/.exec(raw.trim());
    if (kind && bullet) {
      const text = plain(bullet[1]);
      if (text) notes[kind].push(text);
    }
  }
  const total = notes.added.length + notes.changed.length + notes.fixed.length;
  return total > 0 ? notes : undefined;
}

/**
 * Which bullets to show, `budget` at most: one for every section that has any
 * first, so a release of fixes is not summed up by its one new feature, then
 * the rest in order. What is left out is counted per section.
 */
export function summarize(
  notes: ReleaseNotes,
  budget: number,
): { kind: NoteKind; shown: string[]; more: number }[] {
  const kinds: NoteKind[] = ['added', 'changed', 'fixed'];
  const present = kinds.filter((k) => notes[k].length > 0);
  const take: Record<NoteKind, number> = { added: 0, changed: 0, fixed: 0 };
  let left = budget;
  for (const k of present) {
    if (left === 0) break;
    take[k] = 1;
    left--;
  }
  for (const k of present) {
    const extra = Math.min(left, notes[k].length - take[k]);
    take[k] += extra;
    left -= extra;
  }
  return present.map((k) => ({
    kind: k,
    shown: notes[k].slice(0, take[k]),
    more: notes[k].length - take[k],
  }));
}
