/** Settings › About: version, repository, report bugs, community, and the one
 *  action that reaches every setting there is. */
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Linking, Pressable, ScrollView } from 'react-native';

import { Dialog } from '@/components/Dialog';
import { Field, SettingRow, SettingsPage, SwitchList, settingsStyles } from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { useSettings } from '@/store/settings';
import { useToast } from '@/store/toast';

const REPO_URL = 'https://github.com/juananzzz/resonus';
const DISCORD_URL = 'https://discord.gg/pecE8MTPVr';
const KOFI_URL = 'https://ko-fi.com/juananzzz';

export default function AboutSettings() {
  const t = useT();
  const router = useRouter();
  // Five taps on the version open Diagnostics. It exists for chasing a report
  // with someone, so it is not worth a row of its own that everybody else has
  // to scroll past.
  const taps = useRef(0);
  const diagnostics = useSettings((s) => s.diagnostics);
  const setDiagnostics = useSettings((s) => s.setDiagnostics);
  // Restoring every setting used to be a row in the Settings index, in among
  // the categories and looking like one of them, a tap away from the button
  // that puts the app in offline mode. It reaches everything, it is done once
  // if ever, and it belongs with the app itself rather than with any of the
  // categories it would undo, which is what put it here.
  const resetToDefaults = useSettings((s) => s.resetToDefaults);
  const toast = useToast((s) => s.show);
  const [confirmReset, setConfirmReset] = useState(false);

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
        {/* Last of the links and never in the way: the app asks for nothing to
            work, and this is the one place where it is fair to mention that
            somebody is paying for the time it takes. */}
        <SettingRow
          icon="cafe-outline"
          label={t('Support Resonus')}
          onPress={() => Linking.openURL(KOFI_URL)}
        />
        {/* Out in the open, unlike the screen it feeds: it is turned on when
            somebody is being walked through a slowdown, and it has to be as
            easy to turn back off. No description, for the same reason the
            screen has no row: it means nothing to anyone not in that
            conversation. */}
        <SwitchList
          options={[
            {
              label: t('Measure performance'),
              value: diagnostics,
              onChange: setDiagnostics,
            },
          ]}
        />
        {/* Last on the screen: everything above it is a link out or a switch,
            and this is the only thing here that changes something and cannot
            be taken back. The confirmation is what it always had. */}
        <SettingRow
          icon="arrow-undo-outline"
          label={t('Restore default settings')}
          onPress={() => setConfirmReset(true)}
        />
      </ScrollView>

      <Dialog
        visible={confirmReset}
        title={t('Restore default settings')}
        message={t('Your preferences will go back to their defaults. Your language stays.')}
        confirmLabel={t('Restore')}
        onCancel={() => setConfirmReset(false)}
        onConfirm={() => {
          setConfirmReset(false);
          resetToDefaults();
          toast(t('Settings restored'));
        }}
      />
    </SettingsPage>
  );
}
