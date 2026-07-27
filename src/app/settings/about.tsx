/** Settings › About: version, repository, report bugs and community. */
import Constants from 'expo-constants';
import { useEffect, useState } from 'react';
import { Linking, ScrollView, Text } from 'react-native';

import { Field, SettingRow, SettingsPage, settingsStyles } from '@/components/SettingsUI';
import { albumsLabel, songsLabel, useT } from '@/i18n';
import { formatBytes } from '@/lib/format';
import { useDownloads } from '@/store/downloads';
import { useLibraryMirror, type MirrorStats } from '@/store/libraryMirror';
import { useSettings } from '@/store/settings';

const REPO_URL = 'https://github.com/juananzzz/resonus';
const DISCORD_URL = 'https://discord.gg/hpDfszr8r';

export default function AboutSettings() {
  const t = useT();
  const lang = useSettings((s) => s.language);
  // What the app has piled up for offline use. Here rather than in Downloads
  // because it isn't something to manage, it's something to report: a
  // performance complaint can be answered with these numbers instead of
  // guesses about how big it all got (#50).
  const [mirror, setMirror] = useState<MirrorStats | null>(null);
  const downloadedSongs = useDownloads((s) => Object.keys(s.files).length);

  useEffect(() => {
    let alive = true;
    void useLibraryMirror
      .getState()
      .stats()
      .then((s) => {
        if (alive) setMirror(s);
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <SettingsPage title={t('About::app')}>
      <ScrollView contentContainerStyle={settingsStyles.content}>
        <Field
          label={t('Version')}
          value={`Resonus v${Constants.expoConfig?.version ?? '?'}`}
        />
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

        <Text style={settingsStyles.sectionTitle}>{t('Offline data')}</Text>
        <Text style={settingsStyles.sectionDescription}>
          {t('What is kept on the device so your library works without a connection. Useful when reporting a problem.')}
        </Text>
        <Field label={t('Library copy')} value={mirror ? formatBytes(mirror.bytes) : '…'} />
        <Field
          label={t('Albums kept')}
          value={mirror ? albumsLabel(mirror.albums, lang) : '…'}
        />
        <Field
          label={t('Playlists kept')}
          value={mirror ? String(mirror.playlists) : '…'}
        />
        <Field label={t('Downloads')} value={songsLabel(downloadedSongs, lang)} />
        {mirror?.prunedFrom ? (
          <Text style={settingsStyles.sectionDescription}>
            {t('Cleaned up from {size}.', { size: formatBytes(mirror.prunedFrom) })}
          </Text>
        ) : null}
      </ScrollView>
    </SettingsPage>
  );
}
