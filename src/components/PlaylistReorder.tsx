/**
 * Modo "Reordenar" de una playlist: lista arrastrable (mismo motor que la cola)
 * con cabecera Cancelar / Hecho. Trabaja siempre sobre el orden manual; al
 * confirmar devuelve la nueva secuencia de ids para reescribirla en el servidor.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import ReorderableList, {
  useReorderableDrag,
  type ReorderableListReorderEvent,
} from 'react-native-reorderable-list';
import { SafeAreaView } from 'react-native-safe-area-context';

import { coverArtUrl } from '@/api/data';
import { type Song } from '@/api/subsonic';
import { useT } from '@/i18n';
import { listPerf } from '@/lib/listPerf';
import { haptic } from '@/lib/haptics';
import { useSettings } from '@/store/settings';
import { colors, fontSize, spacing, SCREEN_BOTTOM_PADDING } from '@/theme';
import { Cover } from './Cover';
import { useScreenBottomPadding } from '@/hooks/useScreenBottomPadding';

// ReorderableList necesita las celdas montadas para animar el arrastre.
const perf = {
  initialNumToRender: listPerf.initialNumToRender,
  maxToRenderPerBatch: listPerf.maxToRenderPerBatch,
  windowSize: listPerf.windowSize,
};

function ReorderRow({ song }: { song: Song }) {
  const drag = useReorderableDrag();
  const showListArtwork = useSettings((s) => s.showListArtwork);
  return (
    <Pressable style={styles.row} onLongPress={() => { haptic('medium'); drag(); }} delayLongPress={150}>
      {showListArtwork ? (
        <Cover uri={coverArtUrl(song.coverArt ?? song.albumId, 100)} size={44} />
      ) : null}
      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={1}>
          {song.title}
        </Text>
        {song.artist ? (
          <Text style={styles.artist} numberOfLines={1}>
            {song.artist}
          </Text>
        ) : null}
      </View>
      <Pressable hitSlop={8} onPressIn={() => { haptic('medium'); drag(); }}>
        <Ionicons name="reorder-two" size={24} color={colors.textSecondary} />
      </Pressable>
    </Pressable>
  );
}

export function PlaylistReorder({
  songs,
  title,
  onCancel,
  onSave,
}: {
  songs: Song[];
  title: string;
  onCancel: () => void;
  onSave: (songIds: string[]) => void;
}) {
  const t = useT();
  const bottomPad = useScreenBottomPadding();
  const [list, setList] = useState(songs);
  useSettings((s) => s.accentColor); // re-render al cambiar el acento

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable hitSlop={10} accessibilityRole="button" onPress={onCancel}>
          <Text style={[styles.action, { color: colors.accent }]}>{t('Cancel')}</Text>
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {title}
        </Text>
        <Pressable
          hitSlop={10}
          accessibilityRole="button"
          onPress={() => onSave(list.map((s) => s.id))}
        >
          <Text style={[styles.action, styles.done, { color: colors.accent }]}>{t('Done')}</Text>
        </Pressable>
      </View>

      <ReorderableList
        {...perf}
        data={list}
        keyExtractor={(item, i) => `${item.id}-${i}`}
        renderItem={({ item }) => <ReorderRow song={item} />}
        onReorder={({ from, to }: ReorderableListReorderEvent) => {
          setList((cur) => {
            const next = cur.slice();
            const [moved] = next.splice(from, 1);
            next.splice(to, 0, moved);
            return next;
          });
        }}
        contentContainerStyle={[styles.list, { paddingBottom: bottomPad }]}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  headerTitle: { flex: 1, color: colors.text, fontSize: fontSize.md, fontWeight: '700', textAlign: 'center' },
  action: { fontSize: fontSize.md, fontWeight: '600' },
  done: { fontWeight: '800' },
  list: { paddingHorizontal: spacing.lg, paddingBottom: SCREEN_BOTTOM_PADDING },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.background,
  },
  info: { flex: 1 },
  title: { color: colors.text, fontSize: fontSize.md },
  artist: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
});
