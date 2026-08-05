# Translations

One file per language. The **English text is the key**, so `"Direction"` is both
the string in the app and the thing you look up. Anything you don't translate
falls back to English, so a partial file is fine.

**Before you translate a string, you can find out what it is.** Every one of them
is listed in [docs/TRANSLATION-CONTEXT.md](../../../docs/TRANSLATION-CONTEXT.md),
under the screen it shows up on, with what it means where the English is
ambiguous on its own: `Direction` is a sort order and not a compass, `Rate` is
a verb and not a bitrate.

Editing a file here in the GitHub editor is a perfectly good way to do it. If you
have the repo cloned, `pnpm i18n:scaffold <code>` is easier: it writes a file
with only what is left to do, each string with that same context on the line
above it.

`{name}` and `{n}` are replaced at runtime: keep them exactly and translate the
words around them.

Full guide: [TRANSLATING.md](../../../TRANSLATING.md). If a string still isn't
clear, ask. The answer goes into `../context.jsonc` and every translator of
every language is shown it from then on.
