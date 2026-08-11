/**
 * Says that a newer Resonus is out, and installs it.
 *
 * Once a day at most, on a launch: the throttle lives in `checkForUpdate`, and
 * a launch is the one moment somebody is looking at the app itself rather than
 * at a list they came for.
 *
 * Closing it asks again tomorrow, and the switch in Settings › About is the one
 * that stops all of it. There is no per-version dismissal: one day of quiet is
 * short enough not to need one, and a release somebody said no to once is the
 * release they are still on when they report the bug it fixed.
 *
 * The download has its own window rather than living in the dialog: 57 MB needs
 * a progress bar and a way out, and `Dialog` is built for a question.
 */
import { useEffect } from 'react';
import {
  ActivityIndicator,
  AppState,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useAccent } from '@/hooks/useAccent';
import { useT } from '@/i18n';
import { clearDownloadedApk, currentVersion, RELEASES_PAGE } from '@/lib/appUpdate';
import { useAuthStore } from '@/store/auth';
import { useNetworkType } from '@/store/networkType';
import { useSettings } from '@/store/settings';
import { useUpdate } from '@/store/update';
import { colors, fontSize, radius, spacing } from '@/theme';
import { Dialog } from './Dialog';

/** Whether this launch has already asked GitHub. */
let checked = false;

export function UpdatePrompt() {
  const t = useT();
  const accent = useAccent();
  const enabled = useSettings((s) => s.updateCheck);
  const hydrated = useSettings((s) => s.hydrated);
  const offline = useAuthStore((s) => s.offline);
  const cellular = useNetworkType((s) => s.cellular);
  const phase = useUpdate((s) => s.phase);
  const release = useUpdate((s) => s.release);
  const progress = useUpdate((s) => s.progress);
  const check = useUpdate((s) => s.check);
  const start = useUpdate((s) => s.start);
  const resume = useUpdate((s) => s.resume);
  const close = useUpdate((s) => s.close);

  // Only once the settings are read from disk: before that `updateCheck` is its
  // default (on), and someone who had turned it off would be checked on anyway.
  useEffect(() => {
    if (checked || !hydrated || !enabled || offline) return;
    checked = true;
    // Whatever a previous run downloaded is 57 MB of somebody's storage, and
    // by now it has either been installed or given up on.
    clearDownloadedApk();
    void check();
  }, [hydrated, enabled, offline, check]);

  // The answer to «install unknown apps» is not returned to us: the system
  // screen is another app, and coming back is the only news we get.
  useEffect(() => {
    if (phase !== 'permission') return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') resume();
    });
    return () => sub.remove();
  }, [phase, resume]);

  const version = release?.version;
  const megabytes = release?.size ? Math.round(release.size / 1_000_000) : 0;

  return (
    <>
      <Dialog
        visible={phase === 'offered' && !!version}
        title={t('Update available')}
        message={
          // The size only when it is somebody's data plan. On Wi-Fi it is a
          // number that answers a question nobody asked.
          cellular && megabytes > 0
            ? t('Resonus {new} is out. You have {old}. The download is about {mb} MB.', {
                new: `v${version}`,
                old: `v${currentVersion()}`,
                mb: megabytes,
              })
            : t('Resonus {new} is out. You have {old}.', {
                new: `v${version}`,
                old: `v${currentVersion()}`,
              })
        }
        confirmLabel={t('Update')}
        neutral={{
          // What changed is the one thing that answers "should I?", and the
          // notes are written per release and far too long for a dialog. Not a
          // third answer to the question: it closes nothing, because reading
          // what changed and then pressing Update is the point of it. Same
          // words as the row in Settings › About that opens the same page.
          label: t("What's new"),
          onPress: () => void Linking.openURL(release?.pageUrl ?? RELEASES_PAGE),
        }}
        onCancel={close}
        onConfirm={start}
      />

      {/* Nothing to say while the system screen is open: it is on top of us and
          the prompt underneath would only be in the way when it closes. */}
      <Modal
        visible={phase === 'downloading'}
        transparent
        animationType="fade"
        onRequestClose={close}
      >
        <View style={styles.backdrop}>
          <View style={styles.card}>
            <Text style={styles.title}>
              {t('Downloading Resonus {version}', { version: `v${version ?? ''}` })}
            </Text>
            <View style={styles.track}>
              <View
                style={[
                  styles.fill,
                  { width: `${Math.round(progress * 100)}%`, backgroundColor: accent },
                ]}
              />
            </View>
            <View style={styles.status}>
              {/* Until the first bytes land there is no fraction to show, and a
                  bar sitting at zero reads as stuck. */}
              {progress > 0 ? (
                <Text style={styles.percent}>{`${Math.round(progress * 100)}%`}</Text>
              ) : (
                <ActivityIndicator size="small" color={colors.textSecondary} />
              )}
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={close}
              style={({ pressed }) => [styles.cancel, pressed && { opacity: 0.6 }]}
            >
              <Text style={styles.cancelLabel}>{t('Cancel')}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  card: {
    width: '100%',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  title: { color: colors.text, fontSize: fontSize.md, fontWeight: '700' },
  track: {
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceHighlight,
    overflow: 'hidden',
  },
  fill: { height: '100%', backgroundColor: colors.accent },
  status: { minHeight: 20, justifyContent: 'center' },
  percent: { color: colors.textSecondary, fontSize: fontSize.sm },
  cancel: { alignSelf: 'flex-end', paddingVertical: spacing.xs, paddingHorizontal: spacing.sm },
  cancelLabel: { color: colors.textSecondary, fontSize: fontSize.md, fontWeight: '600' },
});
