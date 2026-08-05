#!/usr/bin/env node
/**
 * Takes a filled-in scaffold back into the locale file.
 *
 *   pnpm i18n:merge ru                 reads translate-ru.jsonc
 *   pnpm i18n:merge ru some-file.jsonc
 *
 * The other half of `pnpm i18n:scaffold`. It drops the comments, ignores
 * anything left empty or left as the English, and writes the result into
 * `src/i18n/locales/<code>.json` in the order English keeps, so the diff of a
 * translation round is the strings that changed and nothing else.
 *
 * A key that is not in English is refused rather than written: it is either a
 * typo or a string that has since been renamed, and both are worth hearing
 * about now instead of finding as an untranslated screen later.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { LOCALES_DIR, ROOT, baseKey, en, enKeys, loadLocale, locales, parseJsonc } from './i18n-lib.mjs';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const code = args[0];
const from = args[1] ? join(ROOT, args[1]) : join(ROOT, `translate-${code}.jsonc`);

if (!code) {
  console.error('Usage: pnpm i18n:merge <locale> [file]');
  process.exit(1);
}
if (!existsSync(from)) {
  console.error(`No ${from} to merge. Make one with: pnpm i18n:scaffold ${code}`);
  process.exit(1);
}

let incoming;
try {
  incoming = parseJsonc(readFileSync(from, 'utf8'));
} catch (e) {
  console.error(`${from} is not valid JSON: ${e.message}`);
  console.error('Usually a missing comma, or a " inside a translation that needs to be \\".');
  process.exit(1);
}

const dict = locales.includes(code) ? loadLocale(code) : {};
const existingOrder = { ...dict };
const unknown = [];
let added = 0;
let changed = 0;
let skipped = 0;

for (const [key, value] of Object.entries(incoming)) {
  if (!(baseKey(key) in en)) {
    unknown.push(key);
    continue;
  }
  // Empty, or still the English: not translated yet. Left out rather than
  // written, so a half-finished round does not fill the file with English.
  if (typeof value !== 'string' || value.trim() === '' || value === en[key]) {
    skipped += 1;
    continue;
  }
  if (!(key in dict)) added += 1;
  else if (dict[key] !== value) changed += 1;
  dict[key] = value;
}

if (unknown.length) {
  console.error(`\nThese keys are not in en.json, so nothing would ever look them up:`);
  for (const k of unknown) console.error(`  ${k}`);
  console.error('\nNothing was written. Fix or remove them and run it again.\n');
  process.exit(1);
}

// The file keeps the order it already had, and what is new goes at the end in
// the order English has it. Sorting these files properly was tempting and is
// wrong: none of them is in English order today, so tidying one turns a round
// of ten translated strings into a diff of six hundred moved lines, and
// whoever reviews the pull request can no longer see the work in it. A new
// language, having no order of its own to keep, gets English's.
const ordered = {};
for (const key of Object.keys(existingOrder)) if (key in dict) ordered[key] = dict[key];
for (const key of enKeys) {
  if (key in dict && !(key in ordered)) ordered[key] = dict[key];
  for (const k of Object.keys(dict)) {
    if (k !== key && baseKey(k) === key && !(k in ordered)) ordered[k] = dict[k];
  }
}
for (const [k, v] of Object.entries(dict)) if (!(k in ordered)) ordered[k] = v;

writeFileSync(join(LOCALES_DIR, `${code}.json`), `${JSON.stringify(ordered, null, 2)}\n`);

console.log(`\n${code}.json — ${added} new, ${changed} changed, ${skipped} left for later\n`);
if (!locales.includes(code)) {
  // The file is written, but nothing knows the language exists yet.
  console.log(`"${code}" is a new language: it also needs one row in src/i18n/languages.ts`);
  console.log('(see TRANSLATING.md — or open the pull request with just the .json and');
  console.log('we will add the row for you).\n');
}
console.log(`Check it with: pnpm i18n:status ${code}\n`);
