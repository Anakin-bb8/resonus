/**
 * Every playlist on the server, as a section of the Explore tab.
 *
 * The same list is already the first segment of "Your library", and this is
 * deliberately a second way in rather than a move: a playlist you made is
 * yours and belongs over there, but a Subsonic server also hands back the ones
 * other people made public, and reaching those from the tab that holds the
 * catalogue is what this is for.
 *
 * No sort control and no view toggle. The other sections have them because
 * they browse tens of thousands of rows; a list of playlists is read from the
 * top, and inventing two more stored settings for it would be two more things
 * to keep in step with "Your library" for no gain.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, TextInput, View } from 'react-native';

import { COVER, coverArtUrl, getPlaylists } from '@/api/data';
import { Cover } from '@/components/Cover';
import { EmptyState } from '@/components/EmptyState';
import { Message } from '@/components/Message';
import { useScreenBottomPadding } from '@/hooks/useScreenBottomPadding';
import { useListPadding } from '@/hooks/useScreenSize';
import { songsLabel, useT } from '@/i18n';
import { haptic } from '@/lib/haptics';
import { listPerf } from '@/lib/listPerf';
import { useAuthStore } from '@/store/auth';
import { useMediaMenu } from '@/store/mediaMenu';
import { useSettings } from '@/store/settings';
import { colors, fontSize, radius, spacing, themed } from '@/theme';

export function PlaylistsBrowser() {
  const t = useT();
  const lang = useSettings((s) => s.language);
  const listPad = useListPadding(spacing.lg);
  const bottomPad = useScreenBottomPadding();
  const canFetch = useAuthStore((s) => !!s.auth || s.offline);
  const openMenu = useMediaMenu((s) => s.open);
  const [query, setQuery] = useState('');
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['playlists'],
    queryFn: () => getPlaylists(),
    enabled: canFetch,
  });

  // Memoised, and before the early returns below, because hooks cannot be
  // conditional. Without it the whole list is filtered again on every
  // keystroke, which is the shape of the problem #50 was made of.
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return data ?? [];
    return (data ?? []).filter((p) => p.name.toLowerCase().includes(q));
  }, [data, query]);

  return (
    <View style={styles.frame}>
      <View style={styles.searchRow}>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={18} color={colors.textMuted} />
          <TextInput
            style={styles.input}
            placeholder={t('Find a playlist')}
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            value={query}
            onChangeText={setQuery}
            returnKeyType="search"
          />
          {query.length > 0 ? (
            <Pressable
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('Clear')}
              onPress={() => setQuery('')}
            >
              <Ionicons name="close-circle" size={18} color={colors.textMuted} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {isLoading ? (
        <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.accent} />
      ) : isError ? (
        <Message text={t("Couldn't load playlists.")} onRetry={() => refetch()} />
      ) : shown.length === 0 ? (
        <EmptyState
          icon="list-outline"
          title={query.trim() ? t('No results') : t('No playlists yet')}
        />
      ) : (
        <FlatList
          {...listPerf}
          data={shown}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[
            styles.list,
            { paddingBottom: bottomPad, paddingHorizontal: listPad },
          ]}
          renderItem={({ item }) => (
            <Link href={`/playlist/${item.id}`} asChild>
              <Pressable
                style={styles.row}
                onLongPress={() => {
                  haptic('light');
                  openMenu({ kind: 'playlist', playlist: item });
                }}
              >
                <Cover uri={coverArtUrl(item.coverArt ?? item.id, COVER.thumb)} size={48} />
                <View style={styles.rowInfo}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {item.name}
                  </Text>
                  {item.songCount != null ? (
                    <Text style={styles.rowSub}>{songsLabel(item.songCount, lang)}</Text>
                  ) : null}
                </View>
              </Pressable>
            </Link>
          )}
        />
      )}
    </View>
  );
}

const styles = themed((colors) => ({
  frame: { flex: 1 },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    // The gap to the first row is part of this, not an outer margin, so the
    // list starts where the other sections' lists do.
    paddingBottom: spacing.md,
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 44,
    backgroundColor: colors.surfaceHighlight,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
  },
  input: { flex: 1, color: colors.text, fontSize: fontSize.md, paddingVertical: 0 },
  list: { paddingHorizontal: spacing.lg, gap: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowInfo: { flex: 1 },
  rowTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
  rowSub: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
}));
