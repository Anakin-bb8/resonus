/**
 * Settings › Quality & playback › Scrobbling: when a song counts as played.
 *
 * Two rules rather than one number: a share of the song, which is what makes a
 * listen mean the same on a two-minute track and on a ten-minute one, and a
 * flat time, which is what keeps the long ones from asking for five minutes
 * before they count. Either can be off, and the earlier one is what fires. What
 * they add up to lives in `scrobbleThresholdSec` (#126).
 */
import { ScrollView, Text } from 'react-native';

import { SettingRow, SettingsPage, settingsStyles, SliderRow } from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { formatDuration } from '@/lib/format';
import {
  SCROBBLE_PERCENT_DEFAULT,
  SCROBBLE_SECONDS_DEFAULT,
  SCROBBLE_SECONDS_MAX,
  useSettings,
} from '@/store/settings';

export default function ScrobblingSettings() {
  const t = useT();
  const scrobblePercent = useSettings((s) => s.scrobblePercent);
  const setScrobblePercent = useSettings((s) => s.setScrobblePercent);
  const scrobbleSeconds = useSettings((s) => s.scrobbleSeconds);
  const setScrobbleSeconds = useSettings((s) => s.setScrobbleSeconds);
  const resetScrobbleRules = useSettings((s) => s.resetScrobbleRules);

  const isDefault =
    scrobblePercent === SCROBBLE_PERCENT_DEFAULT && scrobbleSeconds === SCROBBLE_SECONDS_DEFAULT;

  return (
    <SettingsPage title={t('Scrobbling')}>
      <ScrollView contentContainerStyle={settingsStyles.content}>
        <Text style={settingsStyles.sectionDescription}>
          {t('How far into a song it counts as played. Whichever of the two comes first.')}
        </Text>
        <SliderRow
          label={t('Part of the song')}
          value={scrobblePercent}
          max={100}
          step={5}
          formatValue={(v) => (v === 0 ? t('Off') : `${v} %`)}
          fineTune={{ step: 1, doneLabel: t('Done') }}
          onChange={setScrobblePercent}
        />
        {/* Seconds up to a minute, then minutes and seconds: "240 s" is a
            number to work out, and "4:00" is the one people already know. */}
        <SliderRow
          label={t('Time played')}
          value={scrobbleSeconds}
          max={SCROBBLE_SECONDS_MAX}
          step={5}
          formatValue={(v) => (v === 0 ? t('Off') : v < 60 ? `${v} s` : formatDuration(v))}
          fineTune={{ step: 1, doneLabel: t('Done') }}
          onChange={setScrobbleSeconds}
        />
        {/* Both off is a real choice, not a mistake to be corrected, so nothing
            is put back and the line only says what it does. It earns one
            because the play counts on the server stop too, which is further
            than turning off "scrobbling" sounds like it goes. */}
        {scrobblePercent === 0 && scrobbleSeconds === 0 ? (
          <Text style={settingsStyles.sectionDescription}>
            {t('With both off nothing is reported, not even to your own server.')}
          </Text>
        ) : null}
        {/* Hidden while they already are the defaults: a button that does
            nothing still reads as one that might. */}
        {isDefault ? null : (
          <SettingRow
            icon="arrow-undo-outline"
            label={t('Restore defaults')}
            onPress={resetScrobbleRules}
          />
        )}
      </ScrollView>
    </SettingsPage>
  );
}
