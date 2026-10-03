/**
 * The update prompt's summary of a release, read from the notes GitHub sends,
 * which are the CHANGELOG section for that version.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseReleaseNotes, summarize } from '@/lib/releaseNotes';

const BODY = `### Added

- Settings > About > Share diagnostic report, for bug reports.
- Remixers show up as artists, with their remixes under **Appears on** (#215).

### Changed

- The app always reopens where you left it (#225, #226).

### Fixed

- Fragmented M4As no longer stop after two seconds (#242).
- Offline, songs not on the phone are greyed out again.
- Casting retries a track the [TV](https://example.com) refuses.

**Full Changelog**: https://github.com/juananzzz/resonus/compare/v0.7.12...v0.7.13
`;

describe('parseReleaseNotes', () => {
  it('reads the sections and cleans the markdown', () => {
    const notes = parseReleaseNotes(BODY);
    assert.deepEqual(notes, {
      added: [
        'Settings > About > Share diagnostic report, for bug reports.',
        'Remixers show up as artists, with their remixes under Appears on.',
      ],
      changed: ['The app always reopens where you left it.'],
      fixed: [
        'Fragmented M4As no longer stop after two seconds.',
        'Offline, songs not on the phone are greyed out again.',
        'Casting retries a track the TV refuses.',
      ],
    });
  });

  it('gives nothing for notes without the usual headings', () => {
    assert.equal(parseReleaseNotes('Some text\n- a bullet with no section'), undefined);
    assert.equal(parseReleaseNotes(''), undefined);
    assert.equal(parseReleaseNotes(undefined), undefined);
  });
});

describe('summarize', () => {
  it('shows every section before a second line of any', () => {
    const notes = parseReleaseNotes(BODY)!;
    assert.deepEqual(summarize(notes, 3), [
      { kind: 'added', shown: [notes.added[0]], more: 1 },
      { kind: 'changed', shown: [notes.changed[0]], more: 0 },
      { kind: 'fixed', shown: [notes.fixed[0]], more: 2 },
    ]);
  });

  it('fills the budget in order once every section has one', () => {
    const notes = parseReleaseNotes(BODY)!;
    const out = summarize(notes, 4);
    assert.deepEqual(
      out.map((s) => [s.kind, s.shown.length, s.more]),
      [
        ['added', 2, 0],
        ['changed', 1, 0],
        ['fixed', 1, 2],
      ],
    );
  });

  it('leaves out empty sections', () => {
    const notes = parseReleaseNotes('### Fixed\n- One.\n- Two.')!;
    assert.deepEqual(summarize(notes, 4), [{ kind: 'fixed', shown: ['One.', 'Two.'], more: 0 }]);
  });
});
