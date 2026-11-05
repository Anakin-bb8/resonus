#!/usr/bin/env node
/**
 * Writes the F-Droid release notes for the version in app.json, from its
 * section of CHANGELOG.md.
 *
 *   pnpm fastlane:changelog
 *
 * F-Droid reads `fastlane/metadata/android/en-US/changelogs/<versionCode>.txt`
 * from the tagged commit, so this runs before the tag. Its builds are one APK
 * per ABI, each with app.json's code times ten plus a digit
 * (`plugins/withAbiVersionCode.js`), so the same notes go under each of
 * those codes. F-Droid shows at most 500 characters: the notes are cut at a
 * whole line and end with the link to the full ones.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const ABI_DIGITS = [1, 2, 3];
const LIMIT = 500;

const { expo } = JSON.parse(readFileSync(join(ROOT, 'app.json'), 'utf8'));
const version = expo.version;
const code = expo.android.versionCode;

const lines = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8').split('\n');
const start = lines.findIndex((l) => l.startsWith(`## [${version}]`));
if (start < 0) {
  console.error(`CHANGELOG.md has no section for ${version}.`);
  process.exit(1);
}
const end = lines.findIndex((l, i) => i > start && l.startsWith('## ['));
const section = lines.slice(start + 1, end < 0 ? undefined : end);

// Plain text: headings as they are, bullets kept, links reduced to their text.
const plain = section
  .map((l) => l.replace(/^###\s+/, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\*\*|`/g, ''))
  .filter((l, i, all) => l.trim() !== '' || (i > 0 && all[i - 1].trim() !== ''))
  .join('\n')
  .trim();

const link = `https://github.com/juananzzz/resonus/releases/tag/v${version}`;
let notes = plain;
if (notes.length > LIMIT) {
  const room = LIMIT - link.length - 3;
  const kept = [];
  for (const line of plain.split('\n')) {
    if ([...kept, line].join('\n').length > room) break;
    kept.push(line);
  }
  notes = `${kept.join('\n').trim()}\n…\n${link}`;
}

const dir = join(ROOT, 'fastlane/metadata/android/en-US/changelogs');
mkdirSync(dir, { recursive: true });
for (const digit of ABI_DIGITS) {
  writeFileSync(join(dir, `${code * 10 + digit}.txt`), `${notes}\n`);
}
console.log(`Wrote the notes for ${version} under ${ABI_DIGITS.map((d) => code * 10 + d).join(', ')}.`);
