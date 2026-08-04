/** Settings › About: version, repository, report bugs and community. */
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useRef } from 'react';
import { Linking, Pressable, ScrollView } from 'react-native';

import { Field, SettingRow, SettingsPage, SwitchList, settingsStyles } from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { useSettings } from '@/store/settings';

const REPO_URL = 'https://github.com/juananzzz/resonus';
const DISCORD_URL = 'https://discord.gg/pecE8MTPVr';

export default function AboutSettings() {
  const t = useT();
  const router = useRouter();
  // Five taps on the version open Diagnostics. It exists for chasing a report
  // with someone, so it is not worth a row of its own that everybody else has
  // to scroll past.
  const taps = useRef(0);
  const diagnostics = useSettings((s) => s.diagnostics);
  const setDiagnostics = useSettings((s) => s.setDiagnostics);

  return (
    <SettingsPage title={t('About::app')}>
      <ScrollView contentContainerStyle={settingsStyles.content}>
        <Pressable
          onPress={() => {
            taps.current += 1;
            if (taps.current < 5) return;
            taps.current = 0;
            router.push('/settings/diagnostics');
          }}
        >
          <Field
            label={t('Version')}
            value={`Resonus v${Constants.expoConfig?.version ?? '?'}`}
          />
        </Pressable>
        <SettingRow
          icon="logo-github"
          label="GitHub"
          description="juananzzz/resonus"
          onPress={() => Linking.openURL(REPO_URL)}
        />
        <SettingRow
          icon="bug-outline"
          label={t('Report a bug')}
          onPress={() => Linking.openURL(`${REPO_URL}/issues/new`)}
        />
        <SettingRow
          icon="sparkles-outline"
          label={t("What's new")}
          onPress={() => Linking.openURL(`${REPO_URL}/releases`)}
        />
        <SettingRow
          icon="logo-discord"
          label="Discord"
          onPress={() => Linking.openURL(DISCORD_URL)}
        />
        {/* Out in the open, unlike the screen it feeds, because turning it off
            is something to try when the app itself feels slow: whoever is
            chasing that wants the measuring out of the way before believing
            anything else. */}
        <SwitchList
          options={[
            {
              label: t('Measure performance'),
              description: t(
                'Records how long the app takes at things, for the diagnostics report. Turn it off to rule it out as a cause.',
              ),
              value: diagnostics,
              onChange: setDiagnostics,
            },
          ]}
        />
      </ScrollView>
    </SettingsPage>
  );
}
