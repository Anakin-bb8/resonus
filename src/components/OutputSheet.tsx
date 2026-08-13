/**
 * Audio output picker (Spotify Connect style): this phone or a UPnP/DLNA
 * renderer on the network.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useBottomSheetAnim } from '@/hooks/useBottomSheetAnim';
import { useT } from '@/i18n';
import { formatGroupedDeviceLabel, normalizeOutputDisplayName } from '@/lib/format';
import {
  jukeboxConnect,
  jukeboxDisconnect,
  refreshJukeboxAvailability,
  useJukebox,
} from '@/store/jukebox';
import { useToast } from '@/store/toast';
import {
  upnpAvailable,
  upnpConnect,
  upnpDisconnect,
  upnpJoinDevice,
  upnpSearch,
  upnpUngroupDevice,
  useUpnp,
  type UpnpDevice,
} from '@/store/upnp';
import { colors, fontSize, spacing } from '@/theme';

export function OutputSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const t = useT();
  const toast = useToast((s) => s.show);
  const [busyAction, setBusyAction] = useState<string | null>(null);
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
  const close = () => dismiss(onClose);

  const activeUpnpDevice = useMemo(
    () => (upnpId ? devices.find((device) => device.id === upnpId) ?? null : null),
    [devices, upnpId],
  );
  const activeGroupKey = activeUpnpDevice?.isSonos ? activeUpnpDevice.groupId ?? activeUpnpDevice.id : null;
  const activeCoordinatorId = activeUpnpDevice?.coordinatorId ?? activeUpnpDevice?.id ?? null;
  const isSonosSession = !!activeUpnpDevice?.isSonos;

  const activeGroupMembers = activeGroupKey
    ? devices.filter((device) => device.isSonos && (device.groupId ?? device.id) === activeGroupKey)
    : [];
  const activeSonosGroupMode = activeGroupMembers.length > 1;

  const groupedUpnpRows = useMemo(() => {
    const rows: Array<{
      key: string;
      label: string;
      device: UpnpDevice;
      active: boolean;
      groupSize: number;
    }> = [];
    const coveredIds = new Set<string>();
    const groups = new Map<string, UpnpDevice[]>();

    for (const device of devices) {
      if (!device.isSonos) continue;
      const groupKey = device.groupId ?? device.id;
      const group = groups.get(groupKey) ?? [];
      group.push(device);
      groups.set(groupKey, group);
    }

    for (const [groupKey, groupDevices] of groups) {
      if (groupDevices.length === 0) continue;
      groupDevices.forEach((device) => coveredIds.add(device.id));
      const coordinator = groupDevices.find((device) => device.id === device.coordinatorId) ?? groupDevices[0];
      const label =
        groupDevices.length > 1
          ? formatGroupedDeviceLabel(groupDevices.map((device) => device.name))
          : normalizeOutputDisplayName(groupDevices[0].name);
      rows.push({
        key: `sonos-group:${groupKey}`,
        label,
        device: coordinator,
        active: !!upnpId && groupDevices.some((device) => device.id === upnpId),
        groupSize: groupDevices.length,
      });
    }

    for (const device of devices) {
      if (coveredIds.has(device.id)) continue;
      rows.push({
        key: `upnp:${device.id}`,
        label: normalizeOutputDisplayName(device.name),
        device,
        active: device.id === upnpId,
        groupSize: 1,
      });
    }

    return rows.sort((a, b) => a.label.localeCompare(b.label));
  }, [devices, upnpId]);

  const sortedIndividualRows = useMemo(() => {
    if (!isSonosSession) return [] as UpnpDevice[];
    return devices
      .filter((device) => device.isSonos && (activeSonosGroupMode || device.id !== upnpId))
      .sort((a, b) => normalizeOutputDisplayName(a.name).localeCompare(normalizeOutputDisplayName(b.name)));
  }, [activeSonosGroupMode, devices, isSonosSession, upnpId]);

  const currentOutput = phoneActive
    ? {
        icon: <Ionicons name="phone-portrait-outline" size={22} color={colors.accent} />,
        title: t('This phone'),
      }
    : jukeboxActive
      ? {
          icon: <Ionicons name="server-outline" size={22} color={colors.accent} />,
          title: t('Server speakers (Jukebox)'),
        }
      : activeUpnpDevice?.isSonos && activeSonosGroupMode
        ? {
            icon: <MaterialIcons name="speaker-group" size={22} color={colors.accent} />,
            title: formatGroupedDeviceLabel(activeGroupMembers.map((device) => device.name)),
          }
        : {
            icon: activeUpnpDevice?.isTV ? (
              <Ionicons name="tv-outline" size={22} color={colors.accent} />
            ) : activeUpnpDevice ? (
              <MaterialIcons name="speaker" size={22} color={colors.accent} />
            ) : (
              <Ionicons name="phone-portrait-outline" size={22} color={colors.accent} />
            ),
            title: activeUpnpDevice ? normalizeOutputDisplayName(activeUpnpDevice.name) : t('This phone'),
          };

  useEffect(() => {
    if (!visible) return;
    void upnpSearch();
    void refreshJukeboxAvailability();
    const id = setInterval(() => void upnpSearch(), 10000);
    return () => clearInterval(id);
  }, [visible]);

  async function pickPhone() {
    if (upnpId) await upnpDisconnect();
    else if (jukeboxActive) await jukeboxDisconnect();
  }

  async function pickDevice(device: UpnpDevice) {
    if (device.id === upnpId) return;
    const ok = await upnpConnect(device);
    if (!ok) toast(t("Couldn't complete the action"));
  }

  async function pickJukebox() {
    if (jukeboxActive) return;
    // Silent handoff between remote outputs (does not resume on local in between).
    if (upnpId) await upnpDisconnect(true);
    const ok = await jukeboxConnect();
    if (!ok) toast(t("Couldn't complete the action"));
  }

  async function runGroupAction(key: string, action: () => Promise<boolean>) {
    setBusyAction(key);
    try {
      const ok = await action();
      if (!ok) {
        toast(t("Couldn't complete the action"));
        return;
      }
      await upnpSearch();
    } finally {
      setBusyAction(null);
    }
  }

  async function joinToCurrent(deviceId: string) {
    if (!activeCoordinatorId || deviceId === activeCoordinatorId) return;
    await runGroupAction(`join:${deviceId}`, () => upnpJoinDevice(deviceId, activeCoordinatorId));
  }

  async function ungroupDevice(deviceId: string) {
    await runGroupAction(`ungroup:${deviceId}`, () => upnpUngroupDevice(deviceId));
  }

  async function switchToSonosDevice(device: UpnpDevice) {
    if (!device.isSonos || !isSonosSession) {
      await pickDevice(device);
      return;
    }
    if (device.groupId !== activeGroupKey) {
      await pickDevice(device);
      return;
    }
    await runGroupAction(`switch:${device.id}`, async () => {
      const ungroupOk = await upnpUngroupDevice(device.id);
      if (!ungroupOk) return false;
      return upnpConnect(device);
    });
  }

  function Row({
    icon,
    label,
    active,
    onPress,
    action,
  }: {
    icon: React.ReactNode;
    label: string;
    active?: boolean;
    onPress?: () => void;
    action?: React.ReactNode;
  }) {
    return (
      <Pressable
        style={({ pressed }) => [styles.action, pressed && !!onPress && { opacity: 0.6 }]}
        disabled={!onPress}
        onPress={onPress}
      >
        <View style={styles.rowMain}>
          <View style={styles.rowLabelWrap}>
            {icon}
            <Text style={styles.actionText} numberOfLines={1}>
              {label}
            </Text>
          </View>
        </View>
        <View style={styles.rowActionWrap}>
          {action ?? (active ? <Ionicons name="checkmark" size={20} color={colors.accent} /> : null)}
        </View>
      </Pressable>
    );
  }

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={close}>
      <GestureHandlerRootView style={StyleSheet.absoluteFill}>
        <Animated.View style={[styles.backdrop, backdropStyle]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={close} />
        </Animated.View>
        <GestureDetector gesture={pan}>
          <Animated.View
            style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }, sheetStyle]}
            onLayout={onSheetLayout}
          >
            <View style={styles.grabber} />
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.content}
              bounces={false}
            >
              <View style={styles.currentCard}>
                <Text style={styles.currentLabel}>{t('Currently playing on')}</Text>
                <View style={styles.currentRow}>
                  <View style={styles.currentIconWrap}>{currentOutput.icon}</View>
                  <View style={styles.currentTextWrap}>
                    <Text style={styles.currentTitle} numberOfLines={1}>
                      {currentOutput.title}
                    </Text>
                  </View>
                </View>
              </View>

              {!phoneActive ? (
                <Row
                  icon={<Ionicons name="phone-portrait-outline" size={22} color={colors.text} />}
                  label={t('This phone')}
                  onPress={() => void pickPhone()}
                />
              ) : null}

              {jukeboxAvailable && !jukeboxActive ? (
                <Row
                  icon={<Ionicons name="server-outline" size={22} color={colors.text} />}
                  label={t('Server speakers (Jukebox)')}
                  onPress={() => void pickJukebox()}
                />
              ) : null}

              {upnpAvailable
                ? isSonosSession
                  ? sortedIndividualRows.map((device) => {
                      const active = device.id === upnpId;
                      const inActiveGroup = device.groupId === activeGroupKey;
                      const isActiveCoordinator = !!activeCoordinatorId && device.id === activeCoordinatorId;
                      const canJoin = !!activeGroupKey && !inActiveGroup && device.id !== activeCoordinatorId;
                      const canUngroup = inActiveGroup && (activeSonosGroupMode || !isActiveCoordinator);
                      const actionKey = canJoin ? `join:${device.id}` : `ungroup:${device.id}`;
                      const actionBusy = busyAction === actionKey;
                      const action = device.isSonos && (canJoin || canUngroup) ? (
                        <Pressable
                          style={({ pressed }) => [styles.actionButton, { opacity: actionBusy ? 0.8 : pressed ? 0.9 : 1 }]}
                          disabled={actionBusy || busyAction != null}
                          onPress={(event) => {
                            event.stopPropagation();
                            if (canJoin) {
                              void joinToCurrent(device.id);
                              return;
                            }
                            if (!canUngroup) return;
                            void ungroupDevice(device.id);
                          }}
                        >
                          {actionBusy ? (
                            <ActivityIndicator size="small" color={canJoin ? colors.success : colors.danger} />
                          ) : (
                            <Ionicons
                              name={canJoin ? 'add-circle-outline' : 'remove-circle-outline'}
                              size={22}
                              color={canJoin ? colors.success : colors.danger}
                            />
                          )}
                        </Pressable>
                      ) : undefined;

                      return (
                        <Row
                          key={device.id}
                          icon={
                            device.isTV ? (
                              <Ionicons name="tv-outline" size={22} color={colors.text} />
                            ) : (
                              <MaterialIcons name="speaker" size={22} color={colors.text} />
                            )
                          }
                          label={device.name}
                          active={active}
                          onPress={() => void switchToSonosDevice(device)}
                          action={action}
                        />
                      );
                    })
                  : groupedUpnpRows.map((row) => {
                      const icon = row.groupSize > 1 ? (
                        <MaterialIcons name="speaker-group" size={22} color={colors.text} />
                      ) : row.device.isTV ? (
                        <Ionicons name="tv-outline" size={22} color={colors.text} />
                      ) : (
                        <MaterialIcons name="speaker" size={22} color={colors.text} />
                      );

                      return (
                        <Row
                          key={row.key}
                          icon={icon}
                          label={row.label}
                          active={row.active}
                          onPress={() => void pickDevice(row.device)}
                        />
                      );
                    })
                : null}

              <View style={styles.footerArea}>
                <View style={styles.footerRow}>
                  <View style={styles.footerIconSlot}>
                    <ActivityIndicator size="small" color={colors.textSecondary} animating={scanning} />
                  </View>
                  <Text style={styles.footerLabel}>{t('Searching for devices…')}</Text>
                </View>
              </View>
            </ScrollView>
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
    maxHeight: '84%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.textMuted,
    opacity: 0.5,
    marginBottom: spacing.md,
  },
  content: {
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  currentCard: {
    borderRadius: 16,
    backgroundColor: colors.surfaceHighlight,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  currentLabel: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontWeight: '700',
  },
  currentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  currentIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: `${colors.accent}22`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  currentTextWrap: {
    flex: 1,
    gap: 2,
  },
  currentTitle: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    minHeight: 34,
  },
  rowMain: {
    flex: 3,
    minWidth: 0,
  },
  rowLabelWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minWidth: 0,
    flex: 1,
  },
  rowActionWrap: {
    flex: 1,
    alignItems: 'stretch',
    justifyContent: 'center',
    minHeight: 34,
  },
  actionText: { color: colors.text, fontSize: fontSize.md, flexShrink: 1 },
  actionButton: {
    marginLeft: 'auto',
    minWidth: 62,
    minHeight: 30,
    paddingHorizontal: 14,
    paddingVertical: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerArea: {
    minHeight: 32,
    marginTop: 0,
    justifyContent: 'center',
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 28,
  },
  footerIconSlot: {
    width: 20,
    marginRight: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerLabel: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: '500',
    lineHeight: fontSize.sm * 1.2,
  },
});
