#!/usr/bin/env node
/**
 * Rewords an English string, everywhere it is written down, in one go.
 *
 *   pnpm i18n:rename "old English text" "new English text"
 *   pnpm i18n:rename "old" "new" --dry-run
 *
 * The English text is the key, so a clumsy sentence cannot be improved without
 * touching six files: the call in the code, `en.json` on both sides of the
 * colon, the two locales kept here, the note in `context.jsonc`, and the page
 * in `docs/`. Six places is enough friction to leave bad wording alone, which
 * is a bad reason to leave it alone.
 *
 * What it does NOT do is carry the old translations over. A reworded string is
 * a string nobody has read in Spanish, Russian or German since it changed, and
 * keeping their old text would mean a translation nobody has checked sitting
 * there looking finished. They are dropped instead, so the string falls back to
 * English and turns up as missing in `pnpm i18n:status` — which is the signal
 * their translators already go by (see CONTRIBUTING.md). The ones dropped are
 * printed, for pasting into the pull request.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { LOCALES_DIR, ROOT, en, locales } from './i18n-lib.mjs';

const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const [oldKey, newKey] = args.filter((a) => !a.startsWith('--'));

if (!oldKey || !newKey) {
  console.error('Usage: pnpm i18n:rename "old English text" "new English text" [--dry-run]');
  process.exit(1);
}
if (!(oldKey in en)) {
  console.error(`"${oldKey}" is not in en.json. It has to match exactly, punctuation included.`);
  process.exit(1);
}
if (newKey in en) {
  console.error(`"${newKey}" is already a string in en.json. Two keys cannot be the same text.`);
  process.exit(1);
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The literal as it would be written in source, once per way of quoting it. */
const literals = (text) =>
  ["'", '"'].map((q) => q + text.replace(/\\/g, '\\\\').replaceAll(q, `\\${q}`) + q);

/** Rewrites `t('old')` and `tg('old')`, and nothing else: the same words in a
 *  comment, or in prose, are not this string. */
function rewriteSource() {
  const touched = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(name)) continue;
      const src = readFileSync(full, 'utf8');
      let out = src;
      literals(oldKey).forEach((lit, i) => {
        // `\s*` reaches across the line break of a call whose string sits under
        // its opening bracket, which is how the long ones are written.
        out = out.replace(new RegExp(`(\\b(?:t|tg)\\(\\s*)${escapeRe(lit)}`, 'g'), `$1${literals(newKey)[i]}`);
      });
      if (out !== src) {
        touched.push(relative(ROOT, full));
        if (!dry) writeFileSync(full, out);
      }
    }
  };
  walk(join(ROOT, 'src'));
  return touched;
}

/** English keeps the string, under its new name and in its old place, so the
 *  file's order does not move and the diff is the one line. */
function rewriteEnglish() {
  const path = join(LOCALES_DIR, 'en.json');
  const dict = JSON.parse(readFileSync(path, 'utf8'));
  const out = {};
  for (const [k, v] of Object.entries(dict)) {
    if (k === oldKey) out[newKey] = newKey;
    else if (k.startsWith(`${oldKey}::`)) out[newKey + k.slice(oldKey.length)] = v;
    else out[k] = v;
  }
  if (!dry) writeFileSync(path, `${JSON.stringify(out, null, 2)}\n`);
}

/** Every other language loses it: nobody has read the new sentence in theirs. */
function dropFrom(code) {
  const path = join(LOCALES_DIR, `${code}.json`);
  const dict = JSON.parse(readFileSync(path, 'utf8'));
  const gone = [];
  const out = {};
  for (const [k, v] of Object.entries(dict)) {
    if (k === oldKey || k.startsWith(`${oldKey}::`)) gone.push([k, v]);
    else out[k] = v;
  }
  if (gone.length && !dry) writeFileSync(path, `${JSON.stringify(out, null, 2)}\n`);
  return gone;
}

/** The note follows the string it is about. */
function rewriteNotes() {
  const path = join(ROOT, 'src/i18n/context.jsonc');
  const text = readFileSync(path, 'utf8');
  const out = text.replaceAll(JSON.stringify(oldKey), JSON.stringify(newKey));
  if (out !== text && !dry) writeFileSync(path, out);
  return out !== text;
}

const files = rewriteSource();
rewriteEnglish();
const dropped = locales.map((code) => [code, dropFrom(code)]).filter(([, gone]) => gone.length);
const noteMoved = rewriteNotes();

console.log(`\n${dry ? 'Would reword' : 'Reworded'}:\n  ${oldKey}\n→ ${newKey}\n`);
console.log(`  code:    ${files.length ? files.join(', ') : 'no t() call found — does the text match exactly?'}`);
console.log(`  note:    ${noteMoved ? 'moved with it' : 'none to move'}`);
if (noteMoved) {
  // The note travelled, but it was written about the old wording and may quote
  // it back. Only a person can see that.
  console.log('           ↳ read it: a note often quotes the sentence it explains');
}

if (dropped.length) {
  console.log(`\nDropped, so the string falls back to English until it is translated again:`);
  for (const [code, gone] of dropped) for (const [, v] of gone) console.log(`  ${code}: ${v}`);
  console.log(`\nWorth a line in the pull request, and it shows up in pnpm i18n:status by itself.`);
}
console.log(dry ? '\nNothing was written (--dry-run).\n' : '\nNow: pnpm i18n:docs && pnpm i18n:check\n');
