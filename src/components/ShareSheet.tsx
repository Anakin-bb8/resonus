/**
 * Bottom sheet that asks how long a shared link should live, and then makes it.
 *
 * Choosing IS sharing: there is no confirm button, so this costs one tap over
 * the old behaviour of creating the link straight away. The last choice comes
 * back marked the next time, because people who share tend to share the same
 * way twice.
 *
 * Mounted once in the root layout; opened from anywhere with
 * `useSharePicker.getState().open(...)`.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import DateTimePicker, {
  DateTimePickerAndroid,
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useBottomSheetAnim } from '@/hooks/useBottomSheetAnim';
import { useT } from '@/i18n';
import { shareItem } from '@/lib/share';
import { useSettings, SHARE_EXPIRIES, type ShareExpiry } from '@/store/settings';
import { useSharePicker } from '@/store/sharePicker';
import { useToast } from '@/store/toast';
import { colors, fontSize, spacing } from '@/theme';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/**
 * When a link made now should stop working, or undefined to say nothing and
 * leave it to the server. A month is 30 days: nobody sharing an album means
 * "the 31st at this exact time", and the exact date is there for whoever does.
 */
function expiryAt(kind: ShareExpiry): number | undefined {
  const spans: Record<Exclude<ShareExpiry, 'server'>, number> = {
    hour: HOUR,
    day: DAY,
    week: 7 * DAY,
    month: 30 * DAY,
  };
  if (kind === 'server') return undefined;
  return Date.now() + spans[kind];
}

/** Global instance: mounted once, opens from the store. */
export function GlobalShareSheet() {
  const target = useSharePicker((s) => s.target);
  const close = useSharePicker((s) => s.close);
  const insets = useSafeAreaInsets();
  const t = useT();
  const toast = useToast((s) => s.show);
  const lastUsed = useSettings((s) => s.shareExpiry);
  const setLastUsed = useSettings((s) => s.setShareExpiry);
  const { dismiss, pan, backdropStyle, sheetStyle, onSheetLayout } = useBottomSheetAnim(
    !!target,
    close,
  );
  /** The calendar is open (Android shows it as its own dialog). */
  const [pickingDate, setPickingDate] = useState(false);
  /** Waiting for the server to mint the link. */
  const [sharing, setSharing] = useState(false);

  if (!target) return null;

  const labels: Record<ShareExpiry, string> = {
    hour: t('1 hour'),
    day: t('1 day'),
    week: t('1 week'),
    month: t('1 month'),
    server: t("The server's default"),
  };

  /** The calendar's answer: a date, or nothing if it was dismissed. */
  function onDatePicked(event: DateTimePickerEvent, date?: Date) {
    setPickingDate(false);
    if (event.type !== 'set' || !date) return;
    // End of the chosen day: picking "the 5th" means the link works through
    // the 5th, not until midnight opening it.
    date.setHours(23, 59, 59, 999);
    void share(date.getTime());
  }

  /**
   * Tomorrow as the starting point, and nothing before the next hour: a link
   * that expired before it was made is not something to let anyone pick.
   *
   * On Android the calendar is opened imperatively, as its own dialog: as a
   * component it would be rendered inside this sheet's Modal, which is the way
   * to have a native dialog come up behind it.
   */
  function pickDate() {
    if (Platform.OS !== 'android') {
      setPickingDate(true);
      return;
    }
    DateTimePickerAndroid.open({
      value: new Date(Date.now() + DAY),
      minimumDate: new Date(Date.now() + HOUR),
      mode: 'date',
      onChange: onDatePicked,
    });
  }

  /** Creates the link with this expiry and hands it to the system sheet. */
  async function share(expiresAt: number | undefined) {
    if (!target || sharing) return;
    setSharing(true);
    const ok = await shareItem(target.id, target.name, expiresAt);
    setSharing(false);
    dismiss(close);
    if (!ok) toast(t('Couldn’t create the link'));
  }

  return (
    <Modal transparent animationType="none" visible onRequestClose={() => dismiss(close)}>
      {/* Gestures inside an RN Modal need a root view of their own: the Modal
          renders in a native hierarchy outside the app's. */}
      <GestureHandlerRootView style={StyleSheet.absoluteFill}>
        <Animated.View style={[styles.backdrop, backdropStyle]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => dismiss(close)} />
        </Animated.View>
        {/* One drag around everything: this is a short list that never
            scrolls, so nothing else competes for the gesture. */}
        <GestureDetector gesture={pan}>
          <Animated.View
            style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }, sheetStyle]}
            onLayout={onSheetLayout}
          >
            <View style={styles.grabber} />
            <Text style={styles.title} numberOfLines={1}>
              {target.name ? t('Share “{name}”', { name: target.name }) : t('Share')}
            </Text>
            <Text style={styles.subtitle}>{t('The link expires in')}</Text>
            <View style={styles.divider} />
            {sharing ? (
              <ActivityIndicator style={{ marginVertical: spacing.xl }} color={colors.accent} />
            ) : (
              <>
                {SHARE_EXPIRIES.map((kind) => (
                  <Pressable
                    key={kind}
                    style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
                    accessibilityRole="button"
                    onPress={() => {
                      setLastUsed(kind);
                      void share(expiryAt(kind));
                    }}
                  >
                    <Text style={styles.rowText}>{labels[kind]}</Text>
                    {/* The last one used, so sharing the same way twice is a
                        matter of tapping where the tick already is. */}
                    {kind === lastUsed ? (
                      <Ionicons name="checkmark" size={20} color={colors.accent} />
                    ) : null}
                  </Pressable>
                ))}
                <Pressable
                  style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
                  accessibilityRole="button"
                  onPress={pickDate}
                >
                  <Text style={styles.rowText}>{t('Pick a date…')}</Text>
                  <Ionicons name="calendar-outline" size={20} color={colors.textSecondary} />
                </Pressable>
              </>
            )}
          </Animated.View>
        </GestureDetector>
      </GestureHandlerRootView>

      {/* Everywhere that is not Android, where the calendar is a component. */}
      {pickingDate ? (
        <DateTimePicker
          value={new Date(Date.now() + DAY)}
          mode="date"
          minimumDate={new Date(Date.now() + HOUR)}
          onChange={onDatePicked}
        />
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
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
  title: { color: colors.text, fontSize: fontSize.md, fontWeight: '700' },
  subtitle: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    paddingTop: spacing.xs,
    paddingBottom: spacing.md,
  },
  divider: { height: 1, backgroundColor: colors.border, marginBottom: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.lg,
    paddingVertical: spacing.md,
  },
  rowText: { color: colors.text, fontSize: fontSize.md },
});
