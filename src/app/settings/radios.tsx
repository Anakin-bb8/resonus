/**
 * Settings › Appearance › Home › Radios: rebuild the Home radios on demand
 * and choose how often they rebuild themselves.
 *
 * Its own screen, next to Home sections: the radios are a Home shelf with a
 * build behind them (seeds, similars, icons), not a row to reorder, and that
 * build is what both controls here drive.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ScrollView } from 'react-native';

import {
  SelectList,
  SettingRow,
  SettingsGroup,
  SettingsPage,
  settingsStyles,
} from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { refreshRadios } from '@/lib/radioBuild';
import { useSettings, type RadioRefreshCadence } from '@/store/settings';
import { useToast } from '@/store/toast';
import { useTheme } from '@/theme';

export default function RadiosSettings() {
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  useTheme();
  const t = useT();
  const toast = useToast((s) => s.show);
  const queryClient = useQueryClient();
  const cadence = useSettings((s) => s.radioRefreshCadence);
  const setCadence = useSettings((s) => s.setRadioRefreshCadence);
  const [refreshing, setRefreshing] = useState(false);

  // A forced rebuild (new seed artists, new similars, new tracks, new icons),
  // then Home reads what it saved: its shelf paints from the store, and the
  // invalidation below covers the query that triggered the last build.
  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await refreshRadios({ force: true });
      queryClient.invalidateQueries({ queryKey: ['radios'] });
      toast(t('Radios updated'));
    } catch {
      toast(t("Couldn't refresh the radios"));
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <SettingsPage title={t('Radios')}>
      <ScrollView contentContainerStyle={settingsStyles.content}>
        <SettingsGroup>
          <SelectList<RadioRefreshCadence>
            label={t('Update radios automatically')}
            description={t('How often the radios rebuild their artists and tracks.')}
            options={[
              { value: 'day', label: t('Every day') },
              { value: '3days', label: t('Every 3 days') },
              { value: 'week', label: t('Every week') },
              { value: '2weeks', label: t('Every 2 weeks') },
              { value: 'never', label: t('Never') },
            ]}
            value={cadence}
            onChange={setCadence}
          />
          <SettingRow
            label={refreshing ? t('Refreshing radios.') : t('Refresh radios now')}
            description={t('Rebuild the radios with new artists and tracks right away.')}
            icon="refresh-outline"
            onPress={() => void refresh()}
          />
        </SettingsGroup>
      </ScrollView>
    </SettingsPage>
  );
}
