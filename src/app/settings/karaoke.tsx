/**
 * Settings › Vocal removal (Karaoke). Chooses the model, downloads it and sets
 * how much of the voice is kept. The processing is iOS-only (see
 * `modules/vocal-separator`); on anything else the screen says so and the
 * controls are hidden.
 */
import { ScrollView, Text } from 'react-native';

import {
  SelectList,
  SettingRow,
  SettingsGroup,
  SettingsPage,
  settingsStyles,
  SliderRow,
  SwitchList,
} from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { singModelSizeLabel, type SingModelKind } from '@/lib/singModels';
import { useVocalRemoval } from '@/store/vocalRemoval';
import { useTheme } from '@/theme';

/** The slider reads its two ends by name; the middle is a percentage. */
function mixLabel(t: (s: string) => string, value: number): string {
  if (value <= 0) return t('Instrumental');
  if (value >= 100) return t('Vocals');
  return `${value}%`;
}

export default function KaraokeSettings() {
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  useTheme();
  const t = useT();
  const supported = useVocalRemoval((s) => s.supported);
  const kind = useVocalRemoval((s) => s.kind);
  const enabled = useVocalRemoval((s) => s.enabled);
  const mix = useVocalRemoval((s) => s.mix);
  const status = useVocalRemoval((s) => s.status);
  const progress = useVocalRemoval((s) => s.progress);
  const error = useVocalRemoval((s) => s.error);
  const setKind = useVocalRemoval((s) => s.setKind);
  const setEnabled = useVocalRemoval((s) => s.setEnabled);
  const setMix = useVocalRemoval((s) => s.setMix);
  const download = useVocalRemoval((s) => s.download);
  const cancel = useVocalRemoval((s) => s.cancel);
  const remove = useVocalRemoval((s) => s.remove);

  if (!supported) {
    return (
      <SettingsPage title={t('Vocal removal')}>
        <ScrollView contentContainerStyle={settingsStyles.content}>
          <Text style={settingsStyles.sectionDescription}>
            {t('Vocal removal needs an iPhone with iOS 18 or later.')}
          </Text>
        </ScrollView>
      </SettingsPage>
    );
  }

  const ready = status === 'ready';
  const downloading = status === 'downloading';
  const sizeLabel = singModelSizeLabel(kind);

  return (
    <SettingsPage title={t('Vocal removal')}>
      <ScrollView contentContainerStyle={settingsStyles.content}>
        <Text style={settingsStyles.sectionDescription}>
          {t('Vocal removal separates the voice from the music while a song plays, so the lyrics page can turn it down. The voice model is downloaded once and never leaves your phone.')}
        </Text>

        <SettingsGroup>
          <SwitchList
            options={[
              {
                label: t('Vocal removal'),
                description: ready ? undefined : t('Download a voice model first.'),
                value: enabled,
                onChange: setEnabled,
                disabled: !ready,
              },
            ]}
          />
          <SelectList
            label={t('Voice model')}
            options={[
              { value: 'full' as SingModelKind, label: t('Best quality') },
              { value: 'light' as SingModelKind, label: t('Lighter') },
            ]}
            value={kind}
            // Switching mid-download would leave the other model half-installed.
            disabled={downloading}
            disabledLabel={t('Downloading…')}
            onChange={(v) => setKind(v)}
          />
        </SettingsGroup>

        <Text style={settingsStyles.sectionTitle}>{t('Voice model')}</Text>
        <SettingsGroup>
          {ready ? (
            <SettingRow
              icon="trash-outline"
              destructive
              label={t('Remove voice model')}
              description={`${kind === 'light' ? t('Lighter') : t('Best quality')} · ${sizeLabel}`}
              onPress={remove}
            />
          ) : downloading ? (
            <SettingRow
              icon="close-outline"
              label={t('Cancel download')}
              description={`${Math.round(progress * 100)}%`}
              onPress={cancel}
            />
          ) : (
            <SettingRow
              icon="cloud-download-outline"
              label={t('Download voice model')}
              description={`${kind === 'light' ? t('Lighter') : t('Best quality')} · ${sizeLabel}`}
              onPress={() => void download()}
            />
          )}
        </SettingsGroup>

        {error ? (
          <Text style={settingsStyles.sectionDescription}>
            {t('The download failed:')} {error}
          </Text>
        ) : null}

        <Text style={settingsStyles.sectionTitle}>{t('Mix')}</Text>
        <SettingsGroup>
          <SliderRow
            label={t('Voice')}
            description={t('Background on the left, the full voice on the right.')}
            value={Math.round(mix * 100)}
            min={0}
            max={100}
            step={1}
            disabled={!enabled}
            formatValue={(v) => mixLabel(t, v)}
            onChange={(v) => setMix(v / 100)}
          />
        </SettingsGroup>
      </ScrollView>
    </SettingsPage>
  );
}
