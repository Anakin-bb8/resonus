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

import { SelectList, SettingRow, SettingsPage, settingsStyles, SliderRow, SwitchList } from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { formatDuration } from '@/lib/format';
import { useAlbumProgress } from '@/store/albumProgress';
import { AUDIOBOOK_CONTINUE_REWIND_OPTIONS, SCROBBLE_SECONDS_MAX, useSettings } from '@/store/settings';
import { useToast } from '@/store/toast';

export default function ScrobblingSettings() {
  const t = useT();
  const scrobblePercent = useSettings((s) => s.scrobblePercent);
  const setScrobblePercent = useSettings((s) => s.setScrobblePercent);
  const scrobbleSeconds = useSettings((s) => s.scrobbleSeconds);
  const setScrobbleSeconds = useSettings((s) => s.setScrobbleSeconds);
  const saveAudiobookProgress = useSettings((s) => s.saveAudiobookProgress);
  const setSaveAudiobookProgress = useSettings((s) => s.setSaveAudiobookProgress);
  const audiobookContinueRewindSec = useSettings((s) => s.audiobookContinueRewindSec);
  const setAudiobookContinueRewindSec = useSettings((s) => s.setAudiobookContinueRewindSec);
  const resetScrobbleRules = useSettings((s) => s.resetScrobbleRules);
  const toast = useToast((s) => s.show);

  const rewindLabels: Record<number, string> = {
    [5 * 60]: t('5 minutes'),
    [10 * 60]: t('10 minutes'),
    [30 * 60]: t('30 minutes'),
    [60 * 60]: t('1 hour'),
    [2 * 60 * 60]: t('2 hours'),
  };
  const rewindOptions = AUDIOBOOK_CONTINUE_REWIND_OPTIONS.map((sec) => ({
    value: sec,
    label: rewindLabels[sec] ?? t('30 minutes'),
  }));

  function deleteAudiobookProgresses() {
    useAlbumProgress.getState().clearAll();
    toast(t('Audiobook progresses deleted'));
  }

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
        {/* Always here, whether or not the rules have been touched. It is the
            same row in the same place every time the screen opens, which is
            what makes it findable, and appearing only once something has been
            changed is how a way back goes unnoticed by whoever wanted it. */}
        <SettingRow
          icon="arrow-undo-outline"
          label={t('Restore defaults')}
          onPress={resetScrobbleRules}
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
        <Text style={settingsStyles.sectionTitle}>{t('Audiobook progress')}</Text>
        <Text style={settingsStyles.sectionDescription}>
          {t('Remember where you stopped in audiobooks so you can continue later. Stored locally on this device only.')}
        </Text>
        <SwitchList
          options={[
            {
              label: t('Save audiobook progress'),
              value: saveAudiobookProgress,
              onChange: setSaveAudiobookProgress,
            },
          ]}
        />
        <SelectList
          label={t('Continue playing rewind')}
          description={t('When resuming an audiobook, jump back by this amount first.')}
          options={rewindOptions}
          value={audiobookContinueRewindSec}
          onChange={setAudiobookContinueRewindSec}
          disabled={!saveAudiobookProgress}
        />
        <SettingRow
          icon="trash-outline"
          label={t('Delete audiobook progresses')}
          destructive
          onPress={deleteAudiobookProgresses}
        />
      </ScrollView>
    </SettingsPage>
  );
}
