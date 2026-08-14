/**
 * Settings › Quality & playback › Audiobooks: remembering where a book was
 * left, and what Continue does with that.
 *
 * Its own screen for the same reason Scrobbling has one: a switch, a choice and
 * something to delete is a section in its own right, and under Playback it was
 * three rows about books sitting under a heading full of settings about music.
 * Whoever has no audiobooks in their library never has to scroll past it now.
 *
 * Nothing here is reported to anybody: the position is kept on the phone (see
 * `albumProgress`), which is why it never belonged under Scrobbling either.
 */
import { ScrollView } from 'react-native';

import {
  SelectList,
  SettingRow,
  SettingsPage,
  settingsStyles,
  SwitchList,
} from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { useAlbumProgress } from '@/store/albumProgress';
import { useToast } from '@/store/toast';
import { AUDIOBOOK_CONTINUE_REWIND_OPTIONS, useSettings } from '@/store/settings';
import { useTheme } from '@/theme';

export default function AudiobooksSettings() {
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  useTheme();
  const t = useT();
  const saveAudiobookProgress = useSettings((s) => s.saveAudiobookProgress);
  const setSaveAudiobookProgress = useSettings((s) => s.setSaveAudiobookProgress);
  const audiobookContinueRewindSec = useSettings((s) => s.audiobookContinueRewindSec);
  const setAudiobookContinueRewindSec = useSettings((s) => s.setAudiobookContinueRewindSec);
  const toast = useToast((s) => s.show);

  const rewindOptions = AUDIOBOOK_CONTINUE_REWIND_OPTIONS.map((sec) => ({
    value: sec,
    label: sec === 0 ? t('Off') : t('{n} seconds', { n: sec }),
  }));

  function deleteAudiobookProgress() {
    useAlbumProgress.getState().clearAll();
    toast(t('Audiobook progress deleted'));
  }

  return (
    <SettingsPage title={t('Audiobooks')}>
      <ScrollView contentContainerStyle={settingsStyles.content}>
        <SwitchList
          options={[
            {
              label: t('Save audiobook progress'),
              description: t(
                'Remember where you stopped in audiobooks so you can continue later. Stored on this device only.',
              ),
              value: saveAudiobookProgress,
              onChange: setSaveAudiobookProgress,
            },
          ]}
        />
        <SelectList
          label={t('Rewind on resume')}
          description={t('Continue starts this far back from where you stopped.')}
          options={rewindOptions}
          value={audiobookContinueRewindSec}
          onChange={setAudiobookContinueRewindSec}
          disabled={!saveAudiobookProgress}
        />
        {/* Not greyed out with the switch off: what it clears is what was saved
            while it was on, which is exactly when somebody turning it off wants
            it gone. */}
        <SettingRow
          icon="trash-outline"
          label={t('Delete audiobook progress')}
          destructive
          onPress={deleteAudiobookProgress}
        />
      </ScrollView>
    </SettingsPage>
  );
}
