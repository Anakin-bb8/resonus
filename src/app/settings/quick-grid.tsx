/**
 * Settings › Appearance › Quick grid: what feeds the shortcut card grid on
 * Home and how many tiles to show. The grid is dynamic (sorts by last play),
 * so here you don't reorder: you just pick sources and size.
 */
import { ScrollView, Text } from 'react-native';

import { SelectList, SettingsPage, settingsStyles, SwitchList } from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { useAuthStore } from '@/store/auth';
import { useSettings } from '@/store/settings';

const SIZES = [4, 6, 8] as const;

export default function QuickGridSettings() {
  const t = useT();
  // Locally there are no server playlists, so that source is greyed out rather
  // than taken off the list: the grid is made of the same three things
  // whichever mode you are in, and only one of them is out of reach (#114).
  const offline = useAuthStore((s) => s.offline);
  const showQuickGrid = useSettings((s) => s.showQuickGrid);
  const setShowQuickGrid = useSettings((s) => s.setShowQuickGrid);
  const withFavorites = useSettings((s) => s.quickGridFavorites);
  const setWithFavorites = useSettings((s) => s.setQuickGridFavorites);
  const withAlbums = useSettings((s) => s.quickGridAlbums);
  const setWithAlbums = useSettings((s) => s.setQuickGridAlbums);
  const withPlaylists = useSettings((s) => s.quickGridPlaylists);
  const setWithPlaylists = useSettings((s) => s.setQuickGridPlaylists);
  const size = useSettings((s) => s.quickGridSize);
  const setSize = useSettings((s) => s.setQuickGridSize);

  const sources = [
    {
      label: t('Pin favorites'),
      description: t('Keep the Favorites tile first.'),
      value: withFavorites,
      onChange: setWithFavorites,
    },
    {
      label: t('Recent albums'),
      value: withAlbums,
      onChange: setWithAlbums,
    },
    {
      label: t('Playlists'),
      value: withPlaylists,
      onChange: setWithPlaylists,
      disabled: offline,
    },
  ];

  return (
    <SettingsPage title={t('Quick grid')}>
      <ScrollView contentContainerStyle={settingsStyles.content}>
        <SwitchList
          options={[
            {
              label: t('Show quick grid'),
              description: t('The shortcut cards at the top of Home.'),
              value: showQuickGrid,
              onChange: setShowQuickGrid,
            },
          ]}
        />

        {/* Sources and size only make sense with the grid active. */}
        {showQuickGrid ? (
          <>
            <Text style={settingsStyles.sectionTitle}>{t('Sources')}</Text>
            <SwitchList options={sources} />

            <Text style={settingsStyles.sectionTitle}>{t('Size')}</Text>
            <SelectList
              value={size}
              onChange={setSize}
              options={SIZES.map((n) => ({ value: n, label: t('{n} cards', { n }) }))}
            />
          </>
        ) : null}
      </ScrollView>
    </SettingsPage>
  );
}
