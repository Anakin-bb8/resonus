/**
 * Audio output picker (Spotify Connect style): this phone or a UPnP/DLNA
 * renderer on the network. When opened it searches for renderers (~5 s); the
 * active one is shown as the current output.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useEffect } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useBottomSheetAnim } from '@/hooks/useBottomSheetAnim';
import { useT } from '@/i18n';
import { useToast } from '@/store/toast';
import {
  jukeboxConnect,
  jukeboxDisconnect,
  refreshJukeboxAvailability,
  useJukebox,
} from '@/store/jukebox';
import {
  upnpAvailable,
  upnpConnect,
  upnpDisconnect,
  upnpSearch,
  useUpnp,
  type UpnpDevice,
} from '@/store/upnp';
import { colors, fontSize, spacing } from '@/theme';

export function OutputSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const t = useT();
  const toast = useToast((s) => s.show);
  const upnpId = useUpnp((s) => (s.connected ? s.deviceId : null));
  const devices = useUpnp((s) => s.devices);
  const scanning = useUpnp((s) => s.scanning);
  const jukeboxActive = useJukebox((s) => s.active);
  const jukeboxAvailable = useJukebox((s) => s.available);
  const phoneActive = !upnpId && !jukeboxActive;
  const { dismiss, pan, backdropStyle, sheetStyle, onSheetLayout } = useBottomSheetAnim(
    visible,
    onClose,
  );
  // Animated close: the sheet slides down and then notifies the parent (which hides the Modal).
  const close = () => dismiss(onClose);

  useEffect(() => {
    if (!visible) return;
    void upnpSearch();
    void refreshJukeboxAvailability();
    // Re-scan periodically while the sheet is open: SSDP is lossy, so repeating
    // the search lets renderers that missed the first round appear on their own
    // (upnpSearch merges results and no-ops if a scan is still running).
    const id = setInterval(() => void upnpSearch(), 7000);
    return () => clearInterval(id);
  }, [visible]);

  async function pickPhone() {
    close();
    if (upnpId) await upnpDisconnect();
    else if (jukeboxActive) await jukeboxDisconnect();
  }

  async function pickDevice(device: UpnpDevice) {
    close();
    if (device.id === upnpId) return;
    // Silent handoff between remote outputs (does not resume on local in between).
    if (jukeboxActive) await jukeboxDisconnect(true);
    const ok = await upnpConnect(device);
    if (!ok) toast(t("Couldn't complete the action"));
  }

  async function pickJukebox() {
    close();
    if (jukeboxActive) return;
    if (upnpId) await upnpDisconnect(true);
    const ok = await jukeboxConnect();
    if (!ok) toast(t("Couldn't complete the action"));
  }

  function Row({
    icon,
    label,
    active,
    onPress,
  }: {
    icon: React.ReactNode;
    label: string;
    active?: boolean;
    onPress?: () => void;
  }) {
    return (
      <Pressable
        style={({ pressed }) => [styles.action, pressed && !!onPress && { opacity: 0.6 }]}
        disabled={!onPress}
        onPress={onPress}
      >
        {icon}
        <Text style={[styles.actionText, active && { color: colors.accent }]} numberOfLines={1}>
          {label}
        </Text>
        {active ? (
          <Ionicons name="checkmark" size={20} color={colors.accent} style={{ marginLeft: 'auto' }} />
        ) : null}
      </Pressable>
    );
  }

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={close}>
      {/* Gestures inside an RN Modal need a root view of their own: the
          Modal renders in a native hierarchy outside the app's. */}
      <GestureHandlerRootView style={StyleSheet.absoluteFill}>
        <Animated.View style={[styles.backdrop, backdropStyle]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={close} />
        </Animated.View>
        {/* One drag around the whole sheet: what's in here never scrolls,
            so nothing else competes for the gesture. */}
        <GestureDetector gesture={pan}>
          <Animated.View
            style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }, sheetStyle]}
            onLayout={onSheetLayout}
          >
            {/* Spotify-style grabber: the visual cue that the sheet can be
                dragged down to dismiss. */}
            <View style={styles.grabber} />
            <Text style={styles.sheetTitle}>{t('Output')}</Text>

            <Row
              icon={
                <Ionicons
                  name="phone-portrait-outline"
                  size={22}
                  color={phoneActive ? colors.accent : colors.text}
                />
              }
              label={t('This phone')}
              active={phoneActive}
              onPress={phoneActive ? undefined : pickPhone}
            />

            {jukeboxAvailable ? (
              <Row
                icon={
                  <Ionicons
                    name="server-outline"
                    size={22}
                    color={jukeboxActive ? colors.accent : colors.text}
                  />
                }
                label={t('Server speakers (Jukebox)')}
                active={jukeboxActive}
                onPress={jukeboxActive ? undefined : pickJukebox}
              />
            ) : null}

            {upnpAvailable
              ? devices.map((d) => {
                  const active = d.id === upnpId;
                  return (
                    <Row
                      key={d.id}
                      icon={
                        d.isTV ? (
                          <Ionicons name="tv-outline" size={22} color={active ? colors.accent : colors.text} />
                        ) : (
                          <MaterialIcons name="speaker" size={22} color={active ? colors.accent : colors.text} />
                        )
                      }
                      label={d.name}
                      active={active}
                      onPress={() => void pickDevice(d)}
                    />
                  );
                })
              : null}

            {scanning ? (
              <View style={styles.scanRow}>
                <ActivityIndicator size="small" color={colors.textSecondary} />
                <Text style={styles.scanText}>{t('Searching for devices…')}</Text>
              </View>
            ) : upnpAvailable ? (
              <>
                {devices.length === 0 ? <Text style={styles.scanText}>{t('No devices found')}</Text> : null}
                <Pressable
                  style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
                  onPress={() => void upnpSearch()}
                >
                  <Ionicons name="refresh" size={20} color={colors.textSecondary} />
                  <Text style={[styles.actionText, { color: colors.textSecondary }]}>{t('Search again')}</Text>
                </Pressable>
              </>
            ) : null}
          </Animated.View>
        </GestureDetector>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: spacing.lg,
    // Smaller than the old spacing.lg because the grabber below already brings
    // its own margin: together they add up to the same top gap as before.
    paddingTop: spacing.sm,
  },
  // Spotify's little handle. Its only job is to advertise the drag gesture, so
  // it stays discreet: it must read as an affordance, not as a control.
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.textMuted,
    opacity: 0.5,
    marginBottom: spacing.md,
  },
  sheetTitle: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.md,
  },
  actionText: { color: colors.text, fontSize: fontSize.md, flexShrink: 1 },
  scanRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  scanText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    paddingVertical: spacing.sm,
  },
});
