/** Server genre list, in colored cards (Spotify style). */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import {
  Dimensions,
  FlatList,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { type Genre } from '@/api/backend';
import { getGenres } from '@/api/data';
import { isAudiobookGenre } from '@/store/albumProgress';
import { useSettings } from '@/store/settings';
import { EmptyState } from '@/components/EmptyState';
import { GenreCard } from '@/components/GenreCard';
import { GenreGridSkeleton } from '@/components/GenreGridSkeleton';
import { Message } from '@/components/Message';
import { useT } from '@/i18n';
import { useAuthStore } from '@/store/auth';
import {
  colors,
  fontSize,
  radius,
  spacing,
  SCREEN_BOTTOM_PADDING,
  themed,
  useTheme,
} from '@/theme';
import { listPerf } from '@/lib/listPerf';
import { BackChevron } from '@/components/BackChevron';
import { useScreenBottomPadding } from '@/hooks/useScreenBottomPadding';

// Width of each card in the 2-column grid (same as in Search), so the loading
// skeleton matches the actual cards exactly.
const GENRE_W = (Dimensions.get('window').width - spacing.lg * 2 - spacing.sm) / 2;

export default function GenresScreen() {
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  useTheme();
  const bottomPad = useScreenBottomPadding();
  const t = useT();
  const auth = useAuthStore((s) => s.auth);
  const [query, setQuery] = useState('');
  const hideSpokenWord = useSettings((s) => s.saveAudiobookProgress);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['genres'],
    queryFn: () => getGenres(),
    enabled: !!auth,
  });

  const genres = useMemo(() => {
    const all = [...(data ?? [])]
      // Spoken word is not a kind of music to browse through, and a library
      // with forty books in it buried the genres that are. They live behind
      // the Audiobooks chip instead. Kept where they were with the audiobook
      // setting off, which is the switch that means "none of this applies".
      .filter((g) => !hideSpokenWord || !isAudiobookGenre(g.value))
      .sort((a, b) => a.value.localeCompare(b.value));
    const q = query.trim().toLowerCase();
    return q ? all.filter((g) => g.value.toLowerCase().includes(q)) : all;
  }, [data, query, hideSpokenWord]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <BackChevron />
        <Text style={styles.title}>{t('Genres')}</Text>
        <View style={{ width: 26 }} />
      </View>

      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color={colors.textMuted} />
        <TextInput
          style={styles.input}
          placeholder={t('Filter genres')}
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          value={query}
          onChangeText={setQuery}
        />
        {query.length > 0 ? (
          <Pressable hitSlop={10} onPress={() => setQuery('')}>
            <Ionicons name="close-circle" size={18} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>

      {isLoading ? (
        <View style={styles.skeleton}>
          <GenreGridSkeleton width={GENRE_W} />
        </View>
      ) : isError ? (
        <Message text={t("Couldn't load genres.")} onRetry={() => refetch()} />
      ) : (
        <FlatList
        {...listPerf}
          data={genres}
          keyExtractor={(item) => item.value}
          numColumns={2}
          columnWrapperStyle={{ gap: spacing.sm }}
          contentContainerStyle={[styles.list, { paddingBottom: bottomPad }]}
          renderItem={({ item }: { item: Genre }) => <GenreCard name={item.value} />}
          ListEmptyComponent={
            <EmptyState
              icon="pricetags-outline"
              title={t('No genres yet')}
              subtitle={t("Genres come from your music's tags.")}
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = themed((colors) => ({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  title: { color: colors.text, fontSize: fontSize.lg, fontWeight: '800' },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceHighlight,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
  },
  input: { flex: 1, color: colors.text, fontSize: fontSize.md, paddingVertical: spacing.sm },
  list: {
    paddingHorizontal: spacing.lg,
    paddingBottom: SCREEN_BOTTOM_PADDING,
    gap: spacing.sm,
  },
  // Same horizontal margin as the list so the skeleton cards align with the
  // real ones when they arrive.
  skeleton: { paddingHorizontal: spacing.lg },
}));
