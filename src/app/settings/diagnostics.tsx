/**
 * Settings › Diagnostics: what has been keeping the JS thread busy.
 *
 * Reachable by tapping the version five times in About, because it is for
 * chasing a report, not for browsing. The share button hands over the same
 * thing as plain text, which is easier to paste into an issue than a
 * screenshot is to read.
 */
import { useState } from 'react';
import { ScrollView, Share, StyleSheet, Text, View } from 'react-native';

import { SettingRow, SettingsPage, settingsStyles } from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { perfBlocks, perfOps, perfReport, perfSince, resetPerfLog } from '@/lib/perfLog';
import { colors, fontSize, spacing } from '@/theme';

export default function DiagnosticsSettings() {
  const t = useT();
  // Nothing here is reactive: it is a snapshot, refreshed by pulling or by
  // resetting, so reading it doesn't add work of its own.
  const [tick, setTick] = useState(0);
  const blocks = perfBlocks();
  const ops = perfOps();
  const minutes = Math.max(1, Math.round((Date.now() - perfSince()) / 60000));

  return (
    <SettingsPage title={t('Diagnostics')}>
      <ScrollView
        contentContainerStyle={settingsStyles.content}
        // Any scroll refreshes the numbers; no timer polling behind this.
        onScrollEndDrag={() => setTick(tick + 1)}
      >
        <Text style={settingsStyles.sectionDescription}>
          {t('Measured over the last {n} min of use.', { n: minutes })}
        </Text>

        <Text style={settingsStyles.sectionTitle}>{t('Interface freezes')}</Text>
        <Text style={settingsStyles.sectionDescription}>
          {t('Moments when the app stopped responding, longest first.')}
        </Text>
        {blocks.length === 0 ? (
          <Text style={styles.line}>{t('None over 120 ms.')}</Text>
        ) : (
          blocks.map((b, i) => (
            <Text key={i} style={styles.line}>
              {b.ms} ms · {b.during}
            </Text>
          ))
        )}

        <Text style={settingsStyles.sectionTitle}>{t('Time spent')}</Text>
        {ops.length === 0 ? (
          <Text style={styles.line}>{t('Nothing measured yet.')}</Text>
        ) : (
          ops.slice(0, 20).map((o) => (
            <View key={o.tag} style={styles.row}>
              <Text style={styles.tag} numberOfLines={1}>
                {o.tag}
              </Text>
              <Text style={styles.value}>
                {o.count}× · {o.totalMs} ms · {o.maxMs} ms
              </Text>
            </View>
          ))
        )}

        <SettingRow
          icon="share-outline"
          label={t('Share report')}
          onPress={() => void Share.share({ message: perfReport() })}
        />
        <SettingRow
          icon="refresh"
          label={t('Start over')}
          onPress={() => {
            resetPerfLog();
            setTick(tick + 1);
          }}
        />
      </ScrollView>
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  line: { color: colors.textSecondary, fontSize: fontSize.sm, paddingVertical: 2 },
  row: { flexDirection: 'row', gap: spacing.md, paddingVertical: 2 },
  tag: { color: colors.text, fontSize: fontSize.sm, flex: 1 },
  value: { color: colors.textSecondary, fontSize: fontSize.sm },
});
