/** Font picker — list with radio on the active one, like Language. */
import { ScrollView } from 'react-native';

import { SelectList, SettingsPage, settingsStyles } from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { APP_FONT_LABELS, type AppFont, useSettings } from '@/store/settings';
import { useTheme } from '@/theme';

export default function FontSettings() {
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  useTheme();
  const t = useT();
  const appFont = useSettings((s) => s.appFont);
  const setAppFont = useSettings((s) => s.setAppFont);

  const options: { value: AppFont; label: string }[] = (
    Object.keys(APP_FONT_LABELS) as AppFont[]
  ).map((value) => ({
    value,
    // The system font gets the translated suffix; the rest are proper names.
    label: value === 'system' ? `${APP_FONT_LABELS.system} (${t('default')})` : APP_FONT_LABELS[value],
  }));

  return (
    <SettingsPage title={t('Font')}>
      <ScrollView contentContainerStyle={settingsStyles.content}>
        <SelectList options={options} value={appFont} onChange={setAppFont} collapsible={false} />
      </ScrollView>
    </SettingsPage>
  );
}
