/** Full artist discography, as a vertical list or a grid of covers. */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { coverArtUrl, getArtist, type Album } from '@/api/data';
import { AlbumCard } from '@/components/AlbumCard';
import { Cover } from '@/components/Cover';
import { Message } from '@/components/Message';
import { useT } from '@/i18n';
import { listPerf } from '@/lib/listPerf';
import { useAuthStore } from '@/store/auth';
import { useSettings } from '@/store/settings';
import { colors, fontSize, spacing, SCREEN_BOTTOM_PADDING } from '@/theme';

// Same measurements as browsing albums: both are full-screen album grids and
// cards of different sizes between them would look like an accident.
const COLUMNS = 2;
const GAP = spacing.sm;
const CARD = (Dimensions.get('window').width - spacing.lg * 2 - GAP * (COLUMNS - 1)) / COLUMNS;

export default function DiscographyScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const canFetch = useAuthStore((s) => !!s.auth || s.offline);
  const t = useT();
  // Its own preference, not the one from browsing albums: the button on one
  // screen shouldn't silently rearrange the other.
  const layout = useSettings((s) => s.discographyLayout);
  const setLayout = useSettings((s) => s.setDiscographyLayout);
  const grid = layout === 'grid';

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['artist', id],
    queryFn: () => getArtist(id),
    enabled: canFetch && !!id,
  });

  const albums = [...(data?.albums ?? [])].sort((a, b) => (b.year ?? 0) - (a.year ?? 0));

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t('Close')}
          onPress={() => router.back()}
        >
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {data?.artist.name ?? t('Discography')}
        </Text>
        <Pressable
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={grid ? t('List view') : t('Grid view')}
          onPress={() => setLayout(grid ? 'list' : 'grid')}
        >
          <Ionicons name={grid ? 'list' : 'grid-outline'} size={20} color={colors.textSecondary} />
        </Pressable>
      </View>

      {isLoading ? (
        <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.accent} />
      ) : isError || !data ? (
        <Message text={t("Couldn't load the artist.")} onRetry={() => refetch()} />
      ) : (
        <FlatList
          {...listPerf}
          data={albums}
          // Remount on layout change: FlatList reuses rows and gets stuck with
          // stale ones, and `numColumns` can't be hot-swapped either.
          key={layout}
          keyExtractor={(item) => item.id}
          {...(grid
            ? {
                numColumns: COLUMNS,
                columnWrapperStyle: { gap: GAP },
                contentContainerStyle: styles.gridList,
              }
            : { contentContainerStyle: styles.list })}
          renderItem={({ item }: { item: Album }) =>
            grid ? (
              <AlbumCard album={item} width={CARD} />
            ) : (
              <Link href={`/album/${item.id}`} asChild>
                <Pressable style={styles.row}>
                  <Cover uri={coverArtUrl(item.coverArt ?? item.id, 100)} size={56} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {item.name}
                    </Text>
                    {item.year ? <Text style={styles.rowSub}>{item.year}</Text> : null}
                  </View>
                </Pressable>
              </Link>
            )
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  title: { color: colors.text, fontSize: fontSize.lg, fontWeight: '700', flex: 1 },
  list: {
    paddingHorizontal: spacing.lg,
    paddingBottom: SCREEN_BOTTOM_PADDING,
    gap: spacing.md,
  },
  gridList: {
    paddingHorizontal: spacing.lg,
    paddingBottom: SCREEN_BOTTOM_PADDING,
    gap: GAP,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
  rowSub: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
});
