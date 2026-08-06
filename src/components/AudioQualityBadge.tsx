/** Discreet label with the format, the bitrate and the sample rate. */
import { StyleSheet, Text } from 'react-native';

import { type Song } from '@/api/subsonic';
import { qualityLabel } from '@/lib/audioQuality';
import { useAuthStore } from '@/store/auth';
import { useDownloads } from '@/store/downloads';
import { localSourceFor } from '@/store/player';
import { useNetworkType } from '@/store/networkType';
import { useSettings } from '@/store/settings';
import { colors, fontSize } from '@/theme';

export function AudioQualityBadge({ song }: { song: Song }) {
  // Streaming quality depends on the current network (Wi-Fi or mobile data).
  const cellular = useNetworkType((s) => s.cellular);
  const maxBitRate = useSettings((s) => (cellular ? s.maxBitRateCellular : s.maxBitRate));
  const dlUri = useDownloads((s) => s.files[song.id]);
  const dlBitRate = useDownloads((s) => s.dlBitRates[song.id]);
  // Subscribed so the badge follows them; the rule that reads them belongs to
  // the player, and being downloaded no longer means being played from disk
  // (#108). Saying "128 kbps copy" while streaming the original is the kind of
  // lie this badge exists to prevent.
  useSettings((s) => s.preferDownloads);
  useAuthStore((s) => s.offline);
  const fromDisk = !!dlUri && !!localSourceFor(song);
  const label = qualityLabel(song, maxBitRate, fromDisk ? dlUri : undefined, dlBitRate);
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
