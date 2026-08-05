# Translating Resonus

Thanks for helping translate Resonus! If anything here is unclear, open an issue
or ask on [Discord](https://discord.gg/pecE8MTPVr).

## The short version

```sh
pnpm install
pnpm i18n:scaffold ru      # writes translate-ru.jsonc: everything still to do
                           # ...fill it in...
pnpm i18n:merge ru         # takes it back into src/i18n/locales/ru.json
pnpm i18n:status ru        # check what is left
```

`translate-ru.jsonc` gives you one string per block with **where it shows up in
the app** above it, and **what it means** when the English is ambiguous on its
own:

```jsonc
  // Sort sheet · the ascending vs descending toggle. Not a compass direction
  "Direction": "",

  // Settings › Downloads · Free disk space in the storage bar. Not "free of charge"
  "Free": "",
```

That is the whole point of this file existing: a locale `.json` on its own is a
wall of English words with nothing around them, and "what is this string?" is
the question everybody ends up asking. Now the answer arrives with the string.

You can also edit `src/i18n/locales/<code>.json` by hand if you prefer. Nothing
requires the tools.

## How translations work

- The **English text is the key**. Each language has a JSON file in
  `src/i18n/locales/` mapping the English string to its translation.
- Anything not translated falls back to English, so a partial file is fine.
- `{name}`, `{n}`, etc. are **placeholders** — keep them exactly as-is; they get
  replaced at runtime. Only translate the words around them.
- JSON can't hold comments, so what a string means lives in
  [`src/i18n/context.jsonc`](src/i18n/context.jsonc), and the tools above put it
  in front of you. Where a string shows up isn't written down at all: it is read
  off the code, so it can't fall out of date.

### Anything you leave empty is left alone

`pnpm i18n:merge` skips every entry you left blank, and every one still sitting
at the English text. So you can do fifty strings, merge, and come back to the
rest another day: the file only ever gains what you actually translated, and
your pull request shows those lines and nothing else.

## Adding a new language

1. `pnpm i18n:scaffold <code>` and translate what you can. `pnpm i18n:merge
   <code>` creates `src/i18n/locales/<code>.json` for you.
2. Add one row to `LANGUAGES` in `src/i18n/languages.ts`: import your JSON and
   add `{ code: '<code>', name: '<native name>', dict: <import> }`. That's the
   single source of truth — the `Language` type, the display names, the settings
   picker and the persistence all derive from it, so **nothing else needs
   touching**.
3. Only if your language needs **more than 2** plural forms (one / other): add
   its forms to `PLURALS` and its rule to `PLURAL_RULE` in `src/i18n/index.ts`
   (see [Plurals](#plurals)).

Prefer not to touch the code? Just open the PR with the `.json` — we'll add the
one-line row for you.

## Adapt for what sounds natural

**A good translation reads naturally, it isn't literal.** If a word-for-word
translation would sound odd, adapt it — stay close to the original *meaning*, not
the wording.

For example, "Quick grid" or "chips" needn't map to the literal words for
"grid"/"chip" if those sound wrong — an equivalent like "Quick access" is fine,
and folding a couple of UI terms into one natural word is welcome.

## Words the app uses for its own things

These come back over and over, and a language reads much better when the same
idea is said the same way everywhere. Pick your word once and keep it.

| Term | What it is |
| --- | --- |
| **Queue** | The list of songs waiting to play. Not a playlist |
| **Playlist** | A saved list, on the server |
| **Mix** | Songs the app picks itself, to keep playing after a list runs out |
| **Shuffle** / **Repeat** | Play in random order / start again at the end |
| **Crossfade** | One song fading into the next |
| **Downloads** | Songs saved on the phone, to play with no connection |
| **Library metadata copy** | The offline copy of the album, artist and playlist **lists**. Not the songs |
| **Offline mode** | The app working with no server: downloads only |
| **Local profile** | A profile with no server account at all, playing the phone's own files |
| **Quick grid** | The grid of shortcut tiles on Home |
| **Chips** | The row of tappable little category buttons |
| **Cast** / **Output** | Sending the sound to a speaker or a TV, and which one |
| **Scrobble** | Reporting a play to Last.fm or ListenBrainz. Most languages keep the English word |
| **Transcode** | The server re-encoding a song, usually smaller, before sending it |
| **Normalization** | Evening out the loudness between songs (ReplayGain) |

## Plurals

Counted strings like "3 songs" use per-language plural forms, not a single
template, so each language can inflect the noun correctly.

- Most languages need **2 forms** (one / other): English, Spanish, Catalan,
  German are set up this way in `PLURALS`.
- Some need **more**. Russian, for instance, needs **3** (one / few / many).
  The system supports this: give as many forms as your language's rule uses in
  `PLURALS`, and register the rule in `PLURAL_RULE` (`src/i18n/index.ts`).

Russian rule (CLDR):

| Category | When | Example counts |
| --- | --- | --- |
| one  | `n%10 == 1 && n%100 != 11` | 1, 21, 31 |
| few  | `n%10` in 2–4 && `n%100` not in 12–14 | 2, 3, 4, 22 |
| many | everything else | 0, 5–20, 25 |

If a `{n}` string **baked into the JSON** (not one of the counted labels above)
doesn't inflect correctly in your language, **list it in your PR or an issue** —
we'll move it into the plural system so it can be inflected properly.

## Gendered / context-dependent words

A single English key sometimes maps to several words in another language
depending on gender or context. English `About` is one word, but Russian needs
a different one for *About the artist* vs *About the app*.

You don't have to burden every language with that. Most languages just translate
the **base key** (`About`) once and it's used everywhere. If *your* language
needs to distinguish a specific use, add an **override key** shaped
`Base::context` — only in your file; other languages keep just the base:

```jsonc
"About": "Подробности",        // base — the fallback for every use
"About::artist": "Об исполнителе",  // used only on the artist screen
"About::app": "О приложении"        // used only on the About-app screen
```

The app looks up the `::context` key first and falls back to the base if you
didn't add it, so overrides are always optional. `pnpm i18n:status <locale>`
lists every context available to you, where it shows up, and what it falls back
to if you skip it. If a base key needs a context that doesn't exist yet, tell us
and we'll add it.

## When the greetings change over

Home greets you with one of four strings depending on the time: `Good morning`,
`Good afternoon`, `Good evening` and `Good night`. Translating the words is only
half of it, because **the hours they change at are part of the language too**. At
six in the evening English is well into the evening and Spanish is still in the
afternoon.

By default the morning starts at 5, the afternoon at noon and the evening at 6pm,
with anything before the morning being the night. Spanish and Catalan run later
(6, 13 and 21) because midday there is not the afternoon yet.

You cannot set this from your `.json`, since it is three numbers rather than
text. **If those hours are wrong for your language, tell us in your PR or an
issue** and give us yours: when the morning, the afternoon and the evening begin.
It is one line for us to add.

If your language uses the same word for two consecutive slots (Spanish says
"Buenas noches" for both the evening and the small hours), just translate both
keys the same way. Nothing else is needed.

## Checking what's left to translate

```sh
pnpm i18n:status              # summary table for every language
pnpm i18n:status ru           # details for one language (missing / same / stale)
pnpm i18n:status --todo ru    # just the untranslated keys, one per line
```

- **missing** — the key isn't in your file yet (it falls back to English).
- **same** — present but identical to the English text (sometimes that's correct,
  e.g. "Radio"; otherwise it still needs translating).
- **stale** — a key in your file that no longer exists in English; safe to delete.

Everything listed comes with where it shows up and what it means, the same as
the scaffold.

## When a string still isn't clear

**Tell us, and the answer goes in the file rather than in a reply.** Notes live
in [`src/i18n/context.jsonc`](src/i18n/context.jsonc), one line per string, and
they reach every translator of every language from then on: a question answered
on Discord helps one person once. You are welcome to write the note yourself in
your PR — it is one line, in English, saying what the thing is:

```jsonc
"Rate": "Verb: rate the song with stars. Not \"bitrate\"",
```

That file also holds `keepEnglish`: a handful of strings that are **meant to stay
in English**. They are the Diagnostics measurements, which end up in a GitHub
issue, often as a screenshot, and whoever reads them there does not speak every
language we ship. `pnpm i18n:status` does not count them as missing, so you can
ignore them entirely.

## Translation contributors

Thanks to everyone who has contributed translations:

| Language | Contributor(s) |
| --- | --- |
| English | [juananzzz](https://github.com/juananzzz) |
| Español | [juananzzz](https://github.com/juananzzz) |
| Deutsch | [Psychotoxical](https://github.com/Psychotoxical) |
| Català | [juananzzz](https://github.com/juananzzz) |
| Русский | [ztx-lyghters](https://github.com/ztx-lyghters) |
| Italiano | [Anakin-bb8](https://github.com/Anakin-bb8) |
