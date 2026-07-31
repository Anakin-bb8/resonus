/** Discreet label with format, bitrate, and whether it's lossless/Hi-Res. */
import { StyleSheet, Text } from 'react-native';

import { type Song } from '@/api/subsonic';
import { useT } from '@/i18n';
import { qualityLabel } from '@/lib/audioQuality';
import { useDownloads } from '@/store/downloads';
import { useNetworkType } from '@/store/networkType';
import { useSettings } from '@/store/settings';
import { colors, fontSize } from '@/theme';

export function AudioQualityBadge({ song }: { song: Song }) {
  const t = useT();
  // Streaming quality depends on the current network (Wi-Fi or mobile data).
  const cellular = useNetworkType((s) => s.cellular);
  const maxBitRate = useSettings((s) => (cellular ? s.maxBitRateCellular : s.maxBitRate));
  const dlUri = useDownloads((s) => s.files[song.id]);
  const dlBitRate = useDownloads((s) => s.dlBitRates[song.id]);
  const label = qualityLabel(song, maxBitRate, dlUri, dlBitRate, t);
  if (!label) return null;
  return <Text style={styles.badge}>{label}</Text>;
}

const styles = StyleSheet.create({
  badge: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    fontWeight: '500',
  },
});
