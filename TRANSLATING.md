# Translating Resonus

Thanks for helping translate Resonus! If anything here is unclear, open an issue
or ask on [Discord](https://discord.gg/pecE8MTPVr).

## How to do it

```sh
pnpm install
pnpm i18n:scaffold ru      # writes translate-ru.jsonc: everything still to do
                           # ...fill it in...
pnpm i18n:merge ru         # takes it back into src/i18n/locales/ru.json
pnpm i18n:status ru        # what is left
```

Each string comes with where it shows up in the app and, where the English is
ambiguous on its own, what it means:

```jsonc
  // Sort sheet · the ascending vs descending toggle. Not a compass direction
  "Direction": "",

  // Settings › Downloads · Free disk space in the storage bar. Not "free of charge"
  "Free": "",
```

Anything you leave empty is not merged, so you can do fifty strings and come
back to the rest. Your pull request shows the lines you translated and nothing
else.

Without cloning the repo: edit `src/i18n/locales/<code>.json` in the GitHub
editor and read [docs/TRANSLATION-CONTEXT.md](docs/TRANSLATION-CONTEXT.md),
which is the same context as one page, grouped by screen.

## The rules

- The **English text is the key**. Each language has a JSON file in
  `src/i18n/locales/` mapping the English string to its translation.
- Anything not translated falls back to English, so a partial file is fine.
- `{name}`, `{n}` and the like are **placeholders**: keep them exactly as they
  are and translate only the words around them.
- **A good translation reads naturally, it isn't literal.** If word-for-word
  would sound odd, adapt it: stay close to the *meaning*. "Quick grid" needn't
  contain the word for "grid", and folding two UI terms into one natural word
  is welcome.

## Adding a new language

1. `pnpm i18n:scaffold <code>`, translate what you can, `pnpm i18n:merge <code>`.
   That creates `src/i18n/locales/<code>.json`.
2. Add one row to `LANGUAGES` in `src/i18n/languages.ts`:
   `{ code: '<code>', name: '<native name>', dict: <import> }`. It is the single
   source of truth — the type, the settings picker and the persistence all come
   from it, so nothing else needs touching.
3. Only if your language needs **more than 2** plural forms, see below.

Prefer not to touch the code? Open the PR with just the `.json` and we'll add
the row.

## Plurals

Counted strings like "3 songs" use per-language forms, so each language inflects
the noun properly. Most need **2** (one / other) and are already set up in
`PLURALS` (`src/i18n/index.ts`). Some need more: Russian needs **3**, registered
with its rule in `PLURAL_RULE`.

| Category | When | Example counts |
| --- | --- | --- |
| one  | `n%10 == 1 && n%100 != 11` | 1, 21, 31 |
| few  | `n%10` in 2–4 && `n%100` not in 12–14 | 2, 3, 4, 22 |
| many | everything else | 0, 5–20, 25 |

If a `{n}` string **baked into the JSON** doesn't inflect correctly in your
language, say so in your PR and we'll move it into the plural system.

## One English word, two words in your language

English `About` is one word; Russian needs a different one for *About the
artist* and *About the app*. Most languages translate the base key once and use
it everywhere. If yours needs to tell two uses apart, add an **override key**
shaped `Base::context`, only in your file:

```jsonc
"About": "Подробности",             // base — the fallback for every use
"About::artist": "Об исполнителе",  // only on the artist screen
"About::app": "О приложении"        // only on the About-app screen
```

The app tries `::context` first and falls back to the base, so overrides are
always optional. `pnpm i18n:status <locale>` lists the ones available to you. If
a key needs a context that doesn't exist yet, tell us.

## When the greetings change over

Home greets you with `Good morning`, `Good afternoon`, `Good evening` or
`Good night`. **The hours they change at are part of the language too**: at six
in the evening English is well into the evening and Spanish is still in the
afternoon.

By default the morning starts at 5, the afternoon at noon and the evening at
6pm. Spanish and Catalan run later (6, 13, 21). It is three numbers rather than
text, so you cannot set it from your `.json`: **tell us yours in the PR** and we
add the line. If your language uses one word for two consecutive slots (Spanish
says "Buenas noches" for both), just translate both keys the same way.

## Checking what's left

```sh
pnpm i18n:status              # summary table for every language
pnpm i18n:status ru           # missing / same / stale, each with its context
pnpm i18n:status --todo ru    # just the untranslated keys, one per line
```

- **missing** — not in your file yet (falls back to English).
- **same** — present but identical to the English (sometimes right, e.g.
  "Radio"; otherwise still to do).
- **stale** — in your file but no longer in English; safe to delete.

`pnpm i18n:status --gaps` is the other direction: the strings that have no note
written for them yet. If one of those was the one that stumped you, that is
exactly the one worth telling us about.

## When a string still isn't clear

**Tell us, and the answer goes in the file rather than in a reply.** Notes live
in [`src/i18n/context.jsonc`](src/i18n/context.jsonc), one line per string, and
from then on every translator of every language is shown it. Write it yourself
in your PR if you like:

```jsonc
"Rate": "Verb: rate the song with stars. Not \"bitrate\"",
```

That file also holds `keepEnglish`: a few strings meant to **stay in English**,
the Diagnostics measurements, because they are read in issues by people who
don't speak every language we ship. They aren't counted as missing.

## Translation contributors

| Language | Contributor(s) |
| --- | --- |
| English | [juananzzz](https://github.com/juananzzz) |
| Español | [juananzzz](https://github.com/juananzzz) |
| Deutsch | [Psychotoxical](https://github.com/Psychotoxical) |
| Català | [juananzzz](https://github.com/juananzzz) |
| Русский | [ztx-lyghters](https://github.com/ztx-lyghters) |
| Italiano | [Anakin-bb8](https://github.com/Anakin-bb8) |
