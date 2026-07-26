/**
 * Warns, on startup, that Android's battery optimization is restricting the
 * app — the usual reason playback dies in the background, a download stalls or
 * the sleep timer fires late.
 *
 * Asked once per launch, not once ever: the system re-restricts an app by
 * itself after a while without opening it, so «Later» has to mean later.
 * «Don't remind me» is the one that stops it for good (a switch in Settings ›
 * Playback brings it back).
 */
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { useT } from '@/i18n';
import { isBatteryOptimized, openBatterySettings } from '@/lib/batteryOpt';
import { useSettings } from '@/store/settings';
import { Dialog } from './Dialog';

export function BatteryWarning() {
  const t = useT();
  const enabled = useSettings((s) => s.batteryWarning);
  const setEnabled = useSettings((s) => s.setBatteryWarning);
  const hydrated = useSettings((s) => s.hydrated);
  const [visible, setVisible] = useState(false);

  // Only once the settings are read from disk: before that `batteryWarning` is
  // its default (on), and someone who had turned it off would see it anyway.
  useEffect(() => {
    if (hydrated && enabled && isBatteryOptimized()) setVisible(true);
  }, [hydrated, enabled]);

  // Coming back from the system screen: if it was granted there, the dialog
  // has nothing left to say, so it closes itself instead of waiting for an
  // answer that no longer matters.
  useEffect(() => {
    if (!visible) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && !isBatteryOptimized()) setVisible(false);
    });
    return () => sub.remove();
  }, [visible]);

  return (
    <Dialog
      visible={visible}
      title={t('Battery optimization is on')}
      message={t(
        'Android may stop playback in the background, interrupt downloads or delay the sleep timer. Allowing unrestricted battery use fixes it.',
      )}
      confirmLabel={t('Open settings')}
      neutral={{
        label: t('Don’t remind me'),
        onPress: () => {
          setEnabled(false);
          setVisible(false);
        },
      }}
      onCancel={() => setVisible(false)}
      onConfirm={() => {
        setVisible(false);
        openBatterySettings();
      }}
    />
  );
}
