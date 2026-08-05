# Contributing to Resonus

Thanks for wanting to help! Resonus is an Android music player built with
Expo / React Native for Navidrome / OpenSubsonic / Ampache servers, plus a
local offline mode. This guide gets you from zero to a running app and a pull
request, even if you've never touched React Native.

## Prerequisites

- **Node.js 22 or newer** — <https://nodejs.org>
- **pnpm** — `npm install -g pnpm`. Not optional and not interchangeable with
  npm or yarn: this project patches one of its dependencies
  (`patches/expo-audio.patch`, which adds the gapless, lock screen and
  equalizer hooks the app is built on), and pnpm is what applies it. Install
  with anything else and the app will fail to compile in files you never
  touched.
- **JDK 17** — what CI builds with. Android Studio ships one; if you have
  several, point `JAVA_HOME` at 17. Newer JDKs fail with Gradle errors that
  don't say what is wrong.
- **Git**
- **Android Studio** with the Android SDK and at least one emulator (an AVD),
  or a physical Android phone with USB debugging enabled.

## Get the code

1. **Fork** the repo on GitHub (top-right "Fork"), then clone *your* fork:
   ```sh
   git clone https://github.com/<your-user>/resonus.git
   cd resonus
   ```
2. Install dependencies:
   ```sh
   pnpm install
   ```

## Run it on an emulator (or device)

Resonus ships custom native code, so it can't run in the Expo Go app — you
build your own dev app. It's the same flow most contributors use:

1. Open Android Studio → **Device Manager** and start an emulator (▶), or plug
   in a phone with USB debugging on.
2. Build, install and launch:
   ```sh
   pnpm android
   ```
   The **first run is slow**: it generates the native `android/` project and
   compiles with Gradle. Later runs are much faster.
3. For day-to-day **JS/TS changes you don't rebuild** — keep the dev server
   running and the app hot-reloads:
   ```sh
   pnpm start
   ```
   You only need `pnpm android` again when you change **native config**
   (`app.json` plugins, permissions, icons…) or native code. In that case
   regenerate first:
   ```sh
   pnpm expo prebuild --clean -p android && pnpm android
   ```

> The `android/` and `ios/` folders are **generated** and git-ignored (Expo
> Continuous Native Generation). Don't commit them or edit them by hand — change
> `app.json` or a config plugin instead.

### If the build fails

Reproduce what CI does, which is known to work: Node 22, JDK 17,
`pnpm install --frozen-lockfile`, `pnpm expo prebuild --clean -p android`,
`pnpm android`. See `.github/workflows/release.yml`.

The two usual causes are at the top of this page: a package manager that is not
pnpm, and a JDK that is not 17. If it still fails, open an issue with the last
forty lines of the output rather than a description of it — Gradle errors are
only useful verbatim.

Building an APK to try a change is the slowest way to work and gives you no
logs. It is worth the twenty minutes it takes to get `pnpm android` running.

## Native code

Five Expo Modules live in `modules/`, and they are ordinary Android Kotlin:

| Module | What it does |
| --- | --- |
| `audio-eq` | The system equalizer over the app's audio |
| `battery-opt` | Reads and opens Android's battery optimisation settings |
| `car-auto` | Android Auto: the browse tree and the media session |
| `cast-media` | The media session used while casting |
| `upnp-cast` | Finding UPnP/DLNA renderers and playing to them |

Changing any of them means a rebuild (`pnpm android`); Metro does not hot-reload
native code. To compile just one while you iterate:

```sh
cd android && ./gradlew :car-auto:compileDebugKotlin
```

Reading their logs:

```sh
adb logcat -s CarAuto     # the Android Auto module
adb logcat | grep -i resonus
```

`modules/car-auto/.../CarAutoLog.kt` has a `verbose` flag, off by default. Turn
it on while working on browse or playback from the car.

## Android Auto

**An emulator will not do.** Android Auto has to be the real app, and the
system images only carry a stub, so testing needs a phone. What replaces the
car is the **Desktop Head Unit**:

1. Install "Android Auto Desktop Head Unit Emulator" from the Android Studio SDK
   Manager. It lands in `$ANDROID_HOME/extras/google/auto/`.
2. On the phone, in the Android Auto settings, tap the version number seven
   times to unlock developer mode, then from the overflow menu enable **Start
   head unit server**, and **Unknown sources** so a locally built app shows up
   in the car's list.
3. On your machine:
   ```sh
   adb forward tcp:5277 tcp:5277
   $ANDROID_HOME/extras/google/auto/desktop-head-unit
   ```

The logcat ring buffer survives the car disconnecting, so a real drive can be
read afterwards by plugging the phone in and running `adb logcat -d -s CarAuto`.

## Before you commit

Both of these must pass — CI and reviewers expect them green:

```sh
pnpm typecheck
pnpm lint
```

There is no unit test runner. Nearly everything here is UI or device
integration (the audio session, Android Auto, UPnP, the file system, a server on
the other end), and those are checked by using the app rather than mocked. So a
pull request says what was actually tried and what was not: "tested on a Pixel
with Navidrome, not tested offline" is worth more than a green checkmark.

Conventions:

- **TypeScript**, and match the style of the surrounding code.
- **Comments explain why, not what.** They are the fastest way into this
  codebase, and the reason a decision was made outlives the code that made it.
- **Everything in English**: comments, commit messages, docs.
- **Strings are translated**: the English text *is* the key. Add new
  user-facing strings to `en.json`, `es.json` and `ca.json` in
  `src/i18n/locales/`, appended where they belong rather than sorted — the
  files are not alphabetical and reordering one buries your change in the diff.
  **Do not touch `de.json`, `it.json` or `ru.json`**: they have their own
  translators, and a missing string is the signal that reaches them. See
  [TRANSLATING.md](TRANSLATING.md) for plurals and context, and check where a
  language stands with:
  ```sh
  pnpm i18n:status
  ```
  **If the English is ambiguous on its own**, add a line to
  `src/i18n/context.jsonc` saying what it is, and run `pnpm i18n:docs`. `Direction` is a sort order and
  not a compass; `Rate` is a verb and not a bitrate. That one line is what
  every translator of every language gets shown next to the string, and writing
  it while you still remember costs less than answering the question five
  times. Where the string shows up is worked out from your code, so that part
  needs nothing. `pnpm i18n:status --gaps` lists the strings that have no note
  yet, for reading down and spotting the ones that need one.

## Open a pull request

1. Create a branch:
   ```sh
   git checkout -b my-change
   ```
2. Commit your work.
3. Push to your fork:
   ```sh
   git push origin my-change
   ```
4. On GitHub, open a **Pull Request** against `main` of
   `juananzzz/resonus`. Describe **what** changed and **why**; for UI changes,
   a screenshot or screen recording really helps.

One change per pull request. A branch that fixes a bug and also renames things
and also adds a setting is three reviews at once, and the one thing that turns
out to be wrong holds up the two that were right.

That's it — thanks for contributing! 🎵
