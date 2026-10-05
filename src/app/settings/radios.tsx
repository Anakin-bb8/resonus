/**
 * Settings › Appearance › Home › Home sections › Radios: the artist radios as
 * a whole. Reached from their row in Home sections, where the shelf is turned
 * on and placed, since this is the rest of what there is to say about it.
 *
 * Off at the top means off everywhere: no shelf, no radio in the menus, and
 * nothing built or asked for in the background. Below it, how many radios
 * Home offers, whether one keeps playing once its songs run out, and when
 * they are rebuilt.
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
  SwitchList,
} from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { refreshRadios } from '@/lib/radioBuild';
import { RADIO_COUNT_OPTIONS, useSettings, type RadioRefreshCadence } from '@/store/settings';
import { useToast } from '@/store/toast';
import { useTheme } from '@/theme';

export default function RadiosSettings() {
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  useTheme();
  const t = useT();
  const toast = useToast((s) => s.show);
  const queryClient = useQueryClient();
  const enabled = useSettings((s) => s.radiosEnabled);
  const setEnabled = useSettings((s) => s.setRadiosEnabled);
  const count = useSettings((s) => s.radioCount);
  const setCount = useSettings((s) => s.setRadioCount);
  const endless = useSettings((s) => s.radioEndless);
  const setEndless = useSettings((s) => s.setRadioEndless);
  const cadence = useSettings((s) => s.radioRefreshCadence);
  const setCadence = useSettings((s) => s.setRadioRefreshCadence);
  const [refreshing, setRefreshing] = useState(false);

  // A forced rebuild (new seed artists, new similars, new tracks, new icons),
  // then Home reads what it saved: its shelf paints from the store, and the
  // invalidation below covers the query that triggered the last build.
  const refresh = async (quiet = false) => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await refreshRadios({ force: true });
      queryClient.invalidateQueries({ queryKey: ['radios'] });
      if (!quiet) toast(t('Radios updated'));
    } catch {
      if (!quiet) toast(t("Couldn't refresh the radios"));
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <SettingsPage title={t('Radios')}>
      <ScrollView contentContainerStyle={settingsStyles.content}>
        <SettingsGroup>
          <SwitchList
            options={[
              {
                label: t('Artist radios'),
                description: t(
                  'Radios built from the artists you play most. Off, there are none on Home or in the menus, and nothing is fetched for them.',
                ),
                value: enabled,
                onChange: setEnabled,
              },
            ]}
          />
        </SettingsGroup>
        {/* Off, the rest has nothing to act on: taken away rather than greyed. */}
        {enabled ? (
          <SettingsGroup>
            <SelectList<number>
              label={t('Radios on Home')}
              options={RADIO_COUNT_OPTIONS.map((n) => ({ value: n, label: String(n) }))}
              value={count}
              onChange={(n) => {
                setCount(n);
                // More wanted than are saved: built now, in the background.
                void refresh(true);
              }}
            />
            <SwitchList
              options={[
                {
                  label: t('Keep playing when a radio ends'),
                  description: t('When its songs run out, another round from the same artists.'),
                  value: endless,
                  onChange: setEndless,
                },
              ]}
            />
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
        ) : null}
      </ScrollView>
    </SettingsPage>
  );
}
