#!/usr/bin/env node
/**
 * Translation status report. English (`en.json`) is the source of truth; every
 * other locale in `src/i18n/locales/` is compared against it.
 *
 *   pnpm i18n:status              summary table for all locales
 *   pnpm i18n:status es           details for one locale (what's missing, etc.)
 *   pnpm i18n:status --todo es    just the untranslated keys, ready to paste
 *
 * "missing"   = key exists in English but not in the locale (falls back to English).
 * "same"      = present but identical to the English text (often still untranslated).
 * "stale"     = key in the locale that no longer exists in English (safe to delete).
 *
 * Context overrides ("Base::context") are optional, so they never count as
 * missing. They were also invisible here, which meant the only way to learn one
 * existed was reading TRANSLATING.md and hoping it was up to date. The per
 * locale report now lists them, read straight from the calls in the source.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'src/i18n/locales');

const load = (code) => JSON.parse(readFileSync(join(DIR, `${code}.json`), 'utf8'));
const en = load('en');
const enKeys = Object.keys(en);

const locales = readdirSync(DIR)
  .filter((f) => f.endsWith('.json') && f !== 'en.json')
  .map((f) => f.replace('.json', ''))
  .sort();

// A key may carry an optional "::context" suffix (e.g. "About::artist"), an
// override a language adds when the base term ("About") can't cover every use.
// Only the base key lives in English; overrides are valid as long as their base
// exists there, and they never count as missing (nobody is required to add them).
const baseKey = (k) => {
  const i = k.indexOf('::');
  return i === -1 ? k : k.slice(0, i);
};

/** Every `t('Base::context')` used in the source, so the report can offer them. */
function findContextKeys() {
  const out = new Set();
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(name)) {
        const src = readFileSync(full, 'utf8');
        for (const m of src.matchAll(/['"`]([^'"`]+::[^'"`]+)['"`]/g)) out.add(m[1]);
      }
    }
  };
  walk(join(ROOT, 'src'));
  return [...out].filter((k) => baseKey(k) in en).sort();
}

function analyze(code) {
  const dict = load(code);
  const keys = new Set(Object.keys(dict));
  const missing = enKeys.filter((k) => !keys.has(k));
  const same = enKeys.filter((k) => keys.has(k) && dict[k] === en[k]);
  const stale = Object.keys(dict).filter((k) => !(baseKey(k) in en));
  const translated = enKeys.length - missing.length - same.length;
  return { code, dict, missing, same, stale, translated };
}

// Parse args: optional `--todo` flag and an optional locale code.
const args = process.argv.slice(2);
const todo = args.includes('--todo');
const one = args.find((a) => !a.startsWith('--'));

if (one && !locales.includes(one)) {
  console.error(`Unknown locale "${one}". Available: ${locales.join(', ')}`);
  process.exit(1);
}

const pct = (n) => `${Math.round((n / enKeys.length) * 100)}%`;

if (todo) {
  // Bare list of untranslated (missing + same) keys, one per line, to hand off.
  const { missing, same } = analyze(one ?? locales[0]);
  for (const k of [...missing, ...same]) console.log(k);
  process.exit(0);
}

if (one) {
  const r = analyze(one);
  console.log(`\n${one} — ${r.translated}/${enKeys.length} translated (${pct(r.translated)})\n`);
  const section = (title, list) => {
    if (list.length === 0) return;
    console.log(`${title} (${list.length}):`);
    for (const k of list) console.log(`  ${k}`);
    console.log('');
  };
  section('Missing', r.missing);
  section('Same as English', r.same);
  section('Stale (delete these)', r.stale);
  // Optional: only worth adding when the base word can't cover both uses in
  // this language, so these are listed as an offer, not as pending work.
  const contexts = findContextKeys().filter((k) => !(k in r.dict));
  if (contexts.length) {
    console.log(`Context overrides you could add (${contexts.length}, all optional):`);
    for (const k of contexts) console.log(`  ${k}   falls back to "${r.dict[baseKey(k)] ?? en[baseKey(k)]}"`);
    console.log('');
  }
  if (!r.missing.length && !r.same.length && !r.stale.length) console.log('All good ✓\n');
  process.exit(0);
}

// Summary table for every locale.
console.log(`\nSource: en.json — ${enKeys.length} strings\n`);
const rows = locales.map((c) => analyze(c));
const w = Math.max(6, ...locales.map((c) => c.length));
const pad = (s, n) => String(s).padEnd(n);
console.log(`${pad('locale', w)}  translated   missing   same   stale`);
console.log('-'.repeat(w + 38));
for (const r of rows) {
  console.log(
    `${pad(r.code, w)}  ${pad(`${r.translated} (${pct(r.translated)})`, 10)}  ${pad(r.missing.length, 7)}  ${pad(r.same.length, 5)}  ${r.stale.length}`,
  );
}
console.log(`\nDetails: pnpm i18n:status <locale>   ·   list to translate: pnpm i18n:status --todo <locale>\n`);
