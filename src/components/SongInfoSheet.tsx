/**
 * Everything the app knows about one song, in a sheet (#59).
 *
 * The server is the source, and the file's own tags are the fallback: a local
 * profile has no server to ask, and neither does a song whose metadata came out
 * empty. Nothing here is editable; this is for reading, which is the point of
 * the comment tag, where people keep notes that nothing else in the app shows.
 *
 * Only what the song actually has is drawn. A list of twenty labels with
 * fourteen dashes next to them is harder to read than the six lines that were
 * really filled in.
 */
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { coverArtUrl } from '@/api/data';
import { useBottomSheetAnim } from '@/hooks/useBottomSheetAnim';
import { useT } from '@/i18n';
import { qualityLabel, sampleLabel } from '@/lib/audioQuality';
import { formatBytes, formatDuration } from '@/lib/format';
import { useDownloads } from '@/store/downloads';
import { useNetworkType } from '@/store/networkType';
import { useSettings } from '@/store/settings';
import { useSongInfo } from '@/store/songInfo';
import { colors, fontSize, radius, spacing } from '@/theme';
import { Cover } from './Cover';

/** One label and its value. Long values wrap instead of being cut off. */
function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value} selectable>
        {value}
      </Text>
    </View>
  );
}

export function SongInfoSheet() {
  const song = useSongInfo((s) => s.song);
  const closeNow = useSongInfo((s) => s.close);
  const t = useT();
  const insets = useSafeAreaInsets();
  const cellular = useNetworkType((s) => s.cellular);
  const maxBitRate = useSettings((s) => (cellular ? s.maxBitRateCellular : s.maxBitRate));
  const dlUri = useDownloads((s) => (song ? s.files[song.id] : undefined));
  const dlBitRate = useDownloads((s) => (song ? s.dlBitRates[song.id] : undefined));
  const { dismiss, pan, backdropStyle, sheetStyle, onSheetLayout } = useBottomSheetAnim(
    !!song,
    closeNow,
  );

  if (!song) return null;

  const close = () => dismiss(closeNow);

  const rows: { label: string; value: string }[] = [];
  const add = (label: string, value: string | number | undefined | null) => {
    if (value === undefined || value === null || value === '') return;
    rows.push({ label, value: String(value) });
  };

  add(t('Album'), song.album);
  add(t('Artist'), song.artist);
  add(t('Year'), song.year);
  // Disc only when the album has more than one: "1 · disc 1" on a single disc
  // album is noise dressed up as information.
  add(
    t('Track'),
    song.track != null
      ? song.discNumber != null && song.discNumber > 1
        ? `${song.track} · ${t('Disc {n}', { n: song.discNumber })}`
        : String(song.track)
      : undefined,
  );
  add(t('Genre'), song.genres?.map((g) => g.name).join(', ') || song.genre);
  add(t('Duration'), song.duration ? formatDuration(song.duration) : undefined);

  // The player's exact wording, arrow and all, so the same file is not
  // described two different ways on two screens.
  const format = qualityLabel(song, maxBitRate, dlUri, dlBitRate, t);
  add(t('Format'), format);
  // `qualityLabel` folds the sample rate in already, except when it took the
  // transcode branch and dropped the original's specs. Only then is it worth
  // its own line.
  const sample = sampleLabel(song);
  if (sample && (!format || !format.includes(sample))) add(t('Sample rate'), sample);

  add(t('Channels'), song.channelCount);
  add(t('Size'), song.dlBytes ? formatBytes(song.dlBytes) : undefined);
  add(t('Comment'), song.comment);
  add(t('BPM'), song.bpm);
  add(t('Moods'), song.moods?.join(', '));
  add(t('Plays'), song.playCount);
  add(t('Rating'), song.userRating ? `${song.userRating}/5` : undefined);
  add('MusicBrainz', song.musicBrainzId);
  add('ISRC', song.isrc?.join(', '));

  return (
    <Modal transparent animationType="none" visible onRequestClose={close}>
      {/* Gestures inside an RN Modal need a root view of their own: the
          Modal renders in a native hierarchy outside the app's. */}
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
            <View style={styles.headerRow}>
              <Cover uri={coverArtUrl(song.coverArt ?? song.id, 100)} size={48} />
              <View style={{ flex: 1 }}>
                <Text style={styles.title} numberOfLines={2}>
                  {song.title}
                </Text>
                {song.artist ? (
                  <Text style={styles.subtitle} numberOfLines={1}>
                    {song.artist}
                  </Text>
                ) : null}
              </View>
            </View>
            <View style={styles.divider} />
            {/* Scrolls because a comment can be a paragraph, and the drag to
                dismiss is on the sheet, not in here. */}
            <ScrollView
              style={styles.list}
              bounces={false}
              showsVerticalScrollIndicator={false}
            >
              {rows.map((r) => (
                <Row key={r.label} label={r.label} value={r.value} />
              ))}
              {rows.length === 0 ? (
                <Text style={styles.empty}>{t('This song carries no information.')}</Text>
              ) : null}
            </ScrollView>
          </Animated.View>
        </GestureDetector>
      </GestureHandlerRootView>
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
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
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
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  title: { color: colors.text, fontSize: fontSize.md, fontWeight: '700' },
  subtitle: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.md,
  },
  // Capped so a long comment cannot grow the sheet past the screen; below the
  // cap it hugs its content and there is nothing to scroll.
  list: { maxHeight: 420 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  // Fixed width so every value starts on the same column, which is what makes
  // this readable as a table rather than as a list of sentences.
  label: { color: colors.textMuted, fontSize: fontSize.sm, width: 110 },
  value: { color: colors.text, fontSize: fontSize.sm, flex: 1 },
  empty: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    paddingVertical: spacing.md,
    textAlign: 'center',
  },
});
