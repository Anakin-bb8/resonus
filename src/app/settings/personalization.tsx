/** Settings › Appearance: language, theme, song lists and interface. */
import { useRouter } from 'expo-router';
import { ScrollView, Text } from 'react-native';

import {
  SelectList,
  SettingRow,
  SettingsPage,
  settingsStyles,
  SwitchList,
} from '@/components/SettingsUI';
import { canBlurBars } from '@/components/BarBlur';
import { useLocalProfile } from '@/hooks/useLocalProfile';
import { useT } from '@/i18n';
import { haptic } from '@/lib/haptics';
import { useAuthStore } from '@/store/auth';
import { useTheme } from '@/theme';
import {
  APP_FONT_LABELS,
  LANGUAGE_NAMES,
  useSettings,
  type DefaultTab,
  type SwipeAction,
} from '@/store/settings';

export default function AppearanceSettings() {
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  useTheme();
  const router = useRouter();
  const t = useT();
  // The folders tab only exists with a Subsonic server (see library).
  const offline = useAuthStore((s) => s.offline);
  const local = useLocalProfile();
  const serverType = useAuthStore((s) => s.auth?.serverType);
  // Jellyfin has no folder tree to browse, so for that server the setting does
  // not exist at all. Offline it exists and is simply out of reach, which is a
  // different thing and reads as one: greyed out, where it always was (#114).
  // The local profile is the first case, not the second: the tab reads folders
  // off a Subsonic server and there is none, so the switch would be promising a
  // tab that cannot appear. (The phone's music does live in folders, and
  // browsing them is a thing worth having — but it is a thing to build, not a
  // switch to un-grey: `getMusicDirectory` has no local side.)
  const canBrowseFolders = !local && (offline || serverType !== 'jellyfin');
  const language = useSettings((s) => s.language);
  const alwaysShowTabs = useSettings((s) => s.alwaysShowTabs);
  const setAlwaysShowTabs = useSettings((s) => s.setAlwaysShowTabs);
  const showPlayingElsewhere = useSettings((s) => s.showPlayingElsewhere);
  const setShowPlayingElsewhere = useSettings((s) => s.setShowPlayingElsewhere);
  const blurBars = useSettings((s) => s.blurBars);
  const setBlurBars = useSettings((s) => s.setBlurBars);
  const defaultTab = useSettings((s) => s.defaultTab);
  const setDefaultTab = useSettings((s) => s.setDefaultTab);
  const keepScreenOnReturn = useSettings((s) => s.keepScreenOnReturn);
  const setKeepScreenOnReturn = useSettings((s) => s.setKeepScreenOnReturn);
  const libraryShowsPlaylists = useSettings((s) => s.libraryShowsPlaylists);
  const setLibraryShowsPlaylists = useSettings((s) => s.setLibraryShowsPlaylists);
  const swipeAction = useSettings((s) => s.swipeAction);
  const setSwipeAction = useSettings((s) => s.setSwipeAction);
  const swipeLeftAction = useSettings((s) => s.swipeLeftAction);
  const setSwipeLeftAction = useSettings((s) => s.setSwipeLeftAction);
  const showFolderBrowser = useSettings((s) => s.showFolderBrowser);
  const setShowFolderBrowser = useSettings((s) => s.setShowFolderBrowser);
  const hapticsEnabled = useSettings((s) => s.hapticsEnabled);
  const setHapticsEnabled = useSettings((s) => s.setHapticsEnabled);
  const appFont = useSettings((s) => s.appFont);

  return (
    <SettingsPage title={t('Appearance')}>
      <ScrollView contentContainerStyle={settingsStyles.content}>
        <SettingRow
          label={t('Language')}
          description={LANGUAGE_NAMES[language]}
          chevron
          onPress={() => router.push('/settings/language')}
        />
        <SettingRow
          label={t('Theme')}
          chevron
          onPress={() => router.push('/settings/theme')}
        />
        <SettingRow
          label={t('Font')}
          description={APP_FONT_LABELS[appFont]}
          chevron
          onPress={() => router.push('/settings/font')}
        />

        {/* Under its own heading, where the seven switches used to be, and not
            up with the language and the theme: it is its own thing and reads
            like one. */}
        <Text style={settingsStyles.sectionTitle}>{t('Song lists')}</Text>
        <SettingRow
          label={t('Song lists')}
          chevron
          onPress={() => router.push('/settings/song-lists')}
        />

        <Text style={settingsStyles.sectionTitle}>{t('Navigation')}</Text>
        <SwitchList
          options={[
            {
              label: t('Always show the navigation bar'),
              value: alwaysShowTabs,
              onChange: setAlwaysShowTabs,
            },
          ]}
        />
        <SettingRow
          label={t('Navigation bar')}
          chevron
          onPress={() => router.push('/settings/navigation-bar')}
        />
        {/* Android draws the blur from Android 12 on; before that there is
            only a tint, which is what was tried and dropped (b8bb8b1). */}
        {canBlurBars ? (
          <SwitchList
            options={[
              {
                label: t('Navigation bar blur'),
                value: blurBars,
                onChange: setBlurBars,
              },
            ]}
          />
        ) : null}

        <Text style={settingsStyles.sectionTitle}>{t('Explore')}</Text>
        <SettingRow
          label={t('Explore sections')}
          chevron
          onPress={() => router.push('/settings/explore-sections')}
        />
        {/* Guarded as a whole, not with a spread inside the list: SwitchList
            always draws its card, so an empty array left a blank box. */}
        {canBrowseFolders ? (
          <SwitchList
            options={[
              {
                label: t('Folder browsing'),
                description: t(
                  'Browse your library by folders, in the Explore tab (Subsonic servers).',
                ),
                value: showFolderBrowser,
                onChange: setShowFolderBrowser,
                disabled: offline,
              },
            ]}
          />
        ) : null}

        <Text style={settingsStyles.sectionTitle}>{t('Home')}</Text>
        <SwitchList
          options={[
            {
              label: t('Playing on other devices'),
              description: t(
                'At the top of Home, what is playing in your other apps and devices, ready to carry on here.',
              ),
              value: showPlayingElsewhere,
              onChange: setShowPlayingElsewhere,
            },
          ]}
        />
        <SettingRow
          label={t('Home buttons')}
          chevron
          onPress={() => router.push('/settings/home-buttons')}
        />

        <SettingRow
          label={t('Quick grid')}
          chevron
          onPress={() => router.push('/settings/quick-grid')}
        />

        <SettingRow
          label={t('Home chips')}
          chevron
          onPress={() => router.push('/settings/home-chips')}
        />

        <SettingRow
          label={t('Home sections')}
          chevron
          onPress={() => router.push('/settings/home-sections')}
        />

        <SettingRow
          label={t('Greeting')}
          chevron
          onPress={() => router.push('/settings/greeting')}
        />

        <Text style={settingsStyles.sectionTitle}>{t('Interface')}</Text>
        <SelectList<DefaultTab>
          label={t('Open the app on')}
          options={[
            { value: 'index', label: t('Home') },
            { value: 'search', label: t('Search') },
            { value: 'explore', label: t('Explore') },
            { value: 'library', label: t('Your library') },
          ]}
          value={defaultTab}
          onChange={setDefaultTab}
        />
        <SwitchList
          options={[
            {
              label: t('Keep where you were'),
              description: t(
                'Coming back after a few minutes leaves the app on the screen you left, instead of on the tab above.',
              ),
              value: keepScreenOnReturn,
              onChange: setKeepScreenOnReturn,
            },
            {
              label: t('Start on your playlists'),
              description: t(
                'With no chip pressed, Your library shows Favorites and your playlists instead of everything mixed together.',
              ),
              value: libraryShowsPlaylists,
              onChange: setLibraryShowsPlaylists,
            },
          ]}
        />

        <Text style={settingsStyles.sectionTitle}>{t('Interaction')}</Text>
        <SelectList<SwipeAction>
          label={t('Swipe right')}
          options={[
            { value: 'off', label: t('Off') },
            { value: 'queue', label: t('Add to queue') },
            { value: 'next', label: t('Play next') },
            { value: 'favorite', label: t('Add to favorites') },
            { value: 'menu', label: t('More options') },
          ]}
          value={swipeAction}
          onChange={setSwipeAction}
        />
        <SelectList<SwipeAction>
          label={t('Swipe left')}
          options={[
            { value: 'off', label: t('Off') },
            { value: 'queue', label: t('Add to queue') },
            { value: 'next', label: t('Play next') },
            { value: 'favorite', label: t('Add to favorites') },
            { value: 'menu', label: t('More options') },
          ]}
          value={swipeLeftAction}
          onChange={setSwipeLeftAction}
        />
        <SwitchList
          options={[
            {
              label: t('Haptic feedback'),
              value: hapticsEnabled,
              onChange: (v: boolean) => {
                setHapticsEnabled(v);
                // Vibrates on enable: immediate confirmation that it works.
                if (v) haptic('medium');
              },
            },
          ]}
        />
      </ScrollView>
    </SettingsPage>
  );
}
