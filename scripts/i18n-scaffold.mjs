#!/usr/bin/env node
/**
 * Writes the file somebody actually translates in.
 *
 *   pnpm i18n:scaffold ru          what is still missing
 *   pnpm i18n:scaffold ru --all    the whole language, to go over from the top
 *   pnpm i18n:scaffold pt          a language we do not have yet
 *
 * A locale `.json` is a wall of `"Direction": ""` with nothing around it, and
 * what somebody needs in order to translate a string, where it shows up and
 * what it means, is somewhere else: another file, a table in
 * a document, or a question on Discord. This puts all of it above the line
 * being translated, as a comment, which is what gettext, Android and Apple all
 * do for the same reason. When it is filled in, `pnpm i18n:merge` takes it back.
 *
 * The output is JSONC (JSON with comments), so it is not the locale file and
 * cannot be confused for one. It is written outside `src/` and ignored by git.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ROOT,
  describe,
  en,
  enKeys,
  keepEnglish,
  loadLocale,
  locales,
  callSites,
} from './i18n-lib.mjs';

const args = process.argv.slice(2);
const all = args.includes('--all');
const code = args.find((a) => !a.startsWith('--'));

if (!code) {
  console.error('Usage: pnpm i18n:scaffold <locale> [--all]');
  console.error(`Existing locales: ${locales.join(', ')}`);
  process.exit(1);
}

const dict = locales.includes(code) ? loadLocale(code) : {};
const isNew = !locales.includes(code);
const sites = callSites();

// What is left to do: never translated, or still sitting at the English text.
// `--all` hands over everything, for a pass over a language that is finished.
const pending = enKeys.filter((k) => {
  if (keepEnglish.has(k)) return false;
  if (all) return true;
  return !(k in dict) || dict[k] === en[k];
});

const quote = (s) => JSON.stringify(s);
const lines = [
  `// Resonus, ${code}${isNew ? ' (new language)' : ''}: ${pending.length} strings`,
  '//',
  '// Each line is  "English text": "your translation".  Fill in the right-hand',
  '// side and leave the left alone: the English IS the key, so changing it',
  '// breaks the lookup. Anything you leave empty (or leave as the English) is',
  '// simply not merged, so you can stop and come back.',
  '//',
  '// {name}, {n} and the like are replaced at runtime: keep them exactly, and',
  '// translate only the words around them.',
  '//',
  '// When you are done:  pnpm i18n:merge ' + code,
  '{',
];

for (const [i, key] of pending.entries()) {
  const about = describe(key, sites);
  if (about) lines.push(`  // ${about}`);
  const current = dict[key] && dict[key] !== en[key] ? dict[key] : '';
  lines.push(`  ${quote(key)}: ${quote(current)}${i === pending.length - 1 ? '' : ','}`);
  if (i !== pending.length - 1) lines.push('');
}
lines.push('}', '');

const out = join(ROOT, `translate-${code}.jsonc`);
writeFileSync(out, lines.join('\n'));

console.log(`\n${pending.length} strings for "${code}" → translate-${code}.jsonc`);
console.log('Each one comes with where it shows up in the app, and what it means');
console.log('when the English is ambiguous on its own.\n');
console.log(`When you are done:  pnpm i18n:merge ${code}\n`);
