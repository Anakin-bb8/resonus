/**
 * Config plugin: the app's languages in Android's own per-app language setting
 * (Settings > Apps > Resonus > Language, Android 13+).
 *
 * - `res/xml/locales_config.xml`, read off `src/i18n/languages.ts` so adding a
 *   language there is still the only step.
 * - `android:localeConfig` on the application, which is what makes the system
 *   list the app.
 * - `locale|layoutDirection` in MainActivity's `configChanges`: setting the
 *   app's locale is a configuration change, and without them Android recreates
 *   the activity, which in React Native is the whole UI starting over. The
 *   strings are JS's anyway, so there is nothing for a recreate to reload.
 *
 * The two-way sync with the in-app picker lives in `src/lib/appLocale.ts`.
 */
const fs = require('fs');
const path = require('path');
const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');

function languageCodes(projectRoot) {
  const source = fs.readFileSync(path.join(projectRoot, 'src/i18n/languages.ts'), 'utf8');
  const codes = [...source.matchAll(/\{\s*code:\s*'([^']+)'/g)].map((m) => m[1]);
  if (codes.length === 0) throw new Error('withAppLocales: no languages found in languages.ts');
  return codes;
}

function withLocalesXml(config) {
  return withDangerousMod(config, [
    'android',
    (cfg) => {
      const dir = path.join(cfg.modRequest.platformProjectRoot, 'app/src/main/res/xml');
      fs.mkdirSync(dir, { recursive: true });
      const locales = languageCodes(cfg.modRequest.projectRoot)
        .map((code) => `  <locale android:name="${code}" />`)
        .join('\n');
      fs.writeFileSync(
        path.join(dir, 'locales_config.xml'),
        `<?xml version="1.0" encoding="utf-8"?>\n<locale-config xmlns:android="http://schemas.android.com/apk/res/android">\n${locales}\n</locale-config>\n`,
      );
      return cfg;
    },
  ]);
}

function withLocaleManifest(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    if (!app) throw new Error('withAppLocales: no <application> in the manifest');
    app.$['android:localeConfig'] = '@xml/locales_config';
    const main = (app.activity ?? []).find((a) => a.$['android:name'] === '.MainActivity');
    if (!main) throw new Error('withAppLocales: no MainActivity in the manifest');
    const changes = new Set((main.$['android:configChanges'] ?? '').split('|').filter(Boolean));
    changes.add('locale');
    changes.add('layoutDirection');
    main.$['android:configChanges'] = [...changes].join('|');
    return cfg;
  });
}

module.exports = function withAppLocales(config) {
  return withLocaleManifest(withLocalesXml(config));
};
