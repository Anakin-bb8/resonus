/** Font picker — list with radio on the active one, plus custom font. */
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Font from 'expo-font';
import { useState } from 'react';
import { Alert, ScrollView } from 'react-native';

import { SettingRow, SelectList, SettingsPage, settingsStyles } from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { APP_FONT_LABELS, type AppFont, useSettings } from '@/store/settings';
import { useTheme } from '@/theme';

/** Font family name used as the key for every custom font loaded at runtime. */
const CUSTOM_FONT_KEY = 'CustomFont';

export default function FontSettings() {
  useTheme();
  const t = useT();
  const appFont = useSettings((s) => s.appFont);
  const setAppFont = useSettings((s) => s.setAppFont);
  const customFontFamily = useSettings((s) => s.customFontFamily);
  const customFontUri = useSettings((s) => s.customFontUri);
  const setCustomFont = useSettings((s) => s.setCustomFont);
  const [picking, setPicking] = useState(false);

  const options: { value: AppFont; label: string }[] = (
    (Object.keys(APP_FONT_LABELS) as AppFont[]).filter((v) => v !== 'custom')
  ).map((value) => ({
    value,
    label: value === 'system' ? `${APP_FONT_LABELS.system} (${t('default')})` : APP_FONT_LABELS[value],
  }));

  async function pickFont() {
    if (picking) return;
    setPicking(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['font/ttf', 'font/otf', 'application/x-font-ttf', 'application/x-font-otf',
          'application/font-sfnt', 'application/x-openfont', 'font/opentype',
          'font/sfnt', 'application/octet-stream'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      const ext = asset.name.split('.').pop()?.toLowerCase() ?? 'ttf';
      // Copy to the document directory so the URI survives cache cleanup.
      const dest = `${FileSystem.documentDirectory}custom-font.${ext}`;
      await FileSystem.copyAsync({ from: asset.uri, to: dest });
      await Font.loadAsync({ [CUSTOM_FONT_KEY]: { uri: dest } });
      setCustomFont(CUSTOM_FONT_KEY, dest);
      setAppFont('custom');
    } catch {
      Alert.alert(t("Couldn't load the font"), t('Make sure the file is a valid .ttf or .otf font.'));
    } finally {
      setPicking(false);
    }
  }

  function removeCustomFont() {
    setCustomFont(null, null);
    setAppFont('system');
  }

  return (
    <SettingsPage title={t('Font')}>
      <ScrollView contentContainerStyle={settingsStyles.content}>
        <SelectList options={options} value={appFont} onChange={setAppFont} collapsible={false} />
        <SettingRow
          label={APP_FONT_LABELS.custom}
          description={
            appFont === 'custom' && customFontFamily
              ? customFontUri?.split('/').pop() ?? t('Loaded')
              : t('Load a .ttf or .otf file')
          }
          icon="color-filter-outline"
          right={appFont === 'custom' ? t('Active') : undefined}
          onPress={pickFont}
        />
        {appFont === 'custom' && customFontFamily ? (
          <SettingRow
            label={t('Remove custom font')}
            destructive
            onPress={removeCustomFont}
          />
        ) : null}
      </ScrollView>
    </SettingsPage>
  );
}
