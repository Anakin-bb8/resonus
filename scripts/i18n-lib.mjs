/**
 * What the translation tools all need: the English source, each locale, the
 * notes, and — the part that is worked out rather than written down — where in
 * the app each string shows up.
 *
 * Somebody translating a JSON file is looking at "Direction": "" with nothing
 * around it, and the question they ask is always the same one: where is this,
 * what is it. Half of that answer is already in the code. Every string reaches
 * the screen through a `t('…')` call in a file, and in this app a file under
 * `src/app/` IS a screen, so the path is the answer: `src/app/settings/player`
 * is Settings › Player. Deriving it costs nothing and cannot fall behind, which
 * a table kept by hand in a document had been doing for three releases.
 *
 * The other half, what a word means when it is ambiguous on its own, cannot be
 * derived and lives in `src/i18n/context.jsonc`.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const LOCALES_DIR = join(ROOT, 'src/i18n/locales');
const SRC = join(ROOT, 'src');

/** JSON with `//` comments in it, which is the only way a data file can explain itself. */
export function parseJsonc(text) {
  // Only whole-line comments are stripped, so a `//` inside a string is safe:
  // "Website (optional)" and its friends would not survive anything cleverer.
  return JSON.parse(
    text
      .split('\n')
      .filter((line) => !/^\s*\/\//.test(line))
      .join('\n'),
  );
}

export const readJson = (path) => parseJsonc(readFileSync(path, 'utf8'));

export const loadLocale = (code) => readJson(join(LOCALES_DIR, `${code}.json`));

export const en = loadLocale('en');
export const enKeys = Object.keys(en);

export const locales = readdirSync(LOCALES_DIR)
  .filter((f) => f.endsWith('.json') && f !== 'en.json')
  .map((f) => f.replace('.json', ''))
  .sort();

const context = readJson(join(ROOT, 'src/i18n/context.jsonc'));
/** Key → one line saying what it means, for the ones that are ambiguous alone. */
export const notes = context.notes;
/** Keys that are meant to stay in English (see the file). Not counted as missing. */
export const keepEnglish = new Set(context.keepEnglish);

/**
 * A key may carry an optional "::context" suffix (e.g. "About::artist"), an
 * override a language adds when the base term ("About") cannot cover every use.
 * Only the base key lives in English.
 */
export const baseKey = (k) => {
  const i = k.indexOf('::');
  return i === -1 ? k : k.slice(0, i);
};

/** Every `.ts`/`.tsx` file under `src/`. */
function sourceFiles() {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(name)) out.push(full);
    }
  };
  walk(SRC);
  return out;
}

/**
 * Key → the files that ask for it. Read off the `t('…')` and `tg('…')` calls,
 * which is what actually puts a string on a screen.
 *
 * A handful of strings are not written at a call site but sit in a list of
 * options somewhere (the sort orders, the server types on the login screen).
 * Those are found by a second pass over plain string literals, which is looser
 * and so is only trusted for keys the first pass did not place.
 */
export function callSites() {
  const sites = new Map();
  const add = (key, file) => {
    if (!sites.has(key)) sites.set(key, new Set());
    sites.get(key).add(relative(ROOT, file));
  };
  const files = sourceFiles().map((f) => [f, readFileSync(f, 'utf8')]);
  const CALL = /\b(?:t|tg)\(\s*(['"])((?:\\.|(?!\1)[^\\])*)\1/g;
  for (const [file, src] of files) {
    for (const m of src.matchAll(CALL)) add(unescapeLiteral(m[2]), file);
  }
  const placed = new Set(sites.keys());
  const LITERAL = /(['"])((?:\\.|(?!\1)[^\\])*)\1/g;
  for (const [file, src] of files) {
    for (const m of src.matchAll(LITERAL)) {
      const key = unescapeLiteral(m[2]);
      if (key in en && !placed.has(key)) add(key, file);
    }
  }
  // A base key whose every use asks for a context ("About" is only ever called
  // as `About::artist` or `About::app`) shows up wherever its overrides do.
  for (const [key, files] of [...sites]) {
    const base = baseKey(key);
    if (base === key || sites.has(base)) continue;
    for (const file of files) add(base, join(ROOT, file));
  }
  return sites;
}

const unescapeLiteral = (s) => s.replace(/\\(['"\\])/g, '$1');

/** Path → what a person would call that place in the app. */
export function screenName(file) {
  const parts = file.split(sep);
  const name = parts[parts.length - 1].replace(/\.tsx?$/, '');
  if (parts[1] !== 'app') {
    // Not a screen: a component, a store, the player engine. Its own name is
    // the most useful thing we can say, and it is better than nothing.
    return `${name} (${parts[1]})`;
  }
  const route = parts.slice(2, -1).filter((p) => !/^\(.*\)$/.test(p));
  const words = (s) =>
    s
      .replace(/\[.*?\]/g, '')
      .replace(/[-_]/g, ' ')
      .trim();
  const tail = name === 'index' ? '' : words(name);
  const crumbs = [...route.map(words), tail].filter(Boolean);
  if (crumbs.length === 0) return 'Home';
  const title = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  return crumbs.map(title).join(' › ');
}

/** One line saying where a string shows up, or nothing if we cannot tell. */
export function whereShown(key, sites) {
  const files = sites.get(key);
  if (!files) return '';
  const names = [...new Set([...files].map(screenName))].sort();
  if (names.length > 3) return `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;
  return names.join(', ');
}

/** Where it shows up, plus what it means if that needed saying. */
export function describe(key, sites) {
  const where = whereShown(key, sites);
  // An override ("Never::expiry") is the base word in one particular place, so
  // the base's note is the one that explains it.
  const note = notes[key] ?? notes[baseKey(key)];
  if (where && note) return `${where} · ${note}`;
  return note || where;
}
