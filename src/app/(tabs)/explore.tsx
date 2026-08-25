/**
 * Library: everything the server has, in one tab.
 *
 * The whole catalogue used to be reachable only through the Explore chips on
 * Home — six pills that scroll off the edge, each opening a screen you then
 * had to come back out of. The lists themselves were fine; what was missing
 * was somewhere they all lived, so switching from all albums to all songs
 * meant going back to Home first.
 *
 * It is a shell and not a rewrite: each section is the screen that already
 * existed, rendered `embedded` (see `BrowseFrame`). They keep their own
 * search, their own orders and their own choice of rows or a grid, which is
 * also why there is no toolbar here — the one that applies is the section's,
 * and a second row above it would be the same controls twice.
 *
 * "Your library" next door is the other half of the split, and the line
 * between them is whose it is: your playlists, your favourites and your pins
 * there; what the server holds here. Folders moved across for that reason.
 */
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AlbumsBrowser } from '@/app/browse/albums';
import { ArtistsBrowser } from '@/app/browse/artists';
import { SongsBrowser } from '@/app/browse/songs';
import { GenresBrowser } from '@/app/genres';
import { RadioBrowser } from '@/app/radio';
import { FoldersBrowser } from '@/components/FoldersBrowser';
import { OfflineIndicator } from '@/components/OfflineIndicator';
import { useAccent } from '@/hooks/useAccent';
import { useT } from '@/i18n';
import { useAuthStore } from '@/store/auth';
import { useSettings } from '@/store/settings';
import { fontSize, spacing, themed, useTheme } from '@/theme';

type Section = 'albums' | 'artists' | 'songs' | 'genres' | 'radio' | 'folders';

/** In the order they are worth reaching for, and the label each goes by. */
const SECTIONS: { key: Section; label: string }[] = [
  { key: 'albums', label: 'Albums' },
  { key: 'artists', label: 'Artists' },
  { key: 'songs', label: 'Songs' },
  { key: 'genres', label: 'Genres' },
  { key: 'radio', label: 'Radio' },
  { key: 'folders', label: 'Folders' },
];

export default function ExploreScreen() {
  // Repaints on a change of appearance or accent: a tab stays mounted while
  // you are on another one, out of reach of anything else.
  useTheme();
  const t = useT();
  const accent = useAccent();
  const auth = useAuthStore((s) => s.auth);
  const offline = useAuthStore((s) => s.offline);
  const showFolderBrowser = useSettings((s) => s.showFolderBrowser);
  const [section, setSection] = useState<Section>('albums');

  /**
   * Which sections this profile actually has.
   *
   * Albums, artists and songs are answered by the local catalogue too, so they
   * are always there. The other three need the server, each for its own
   * reason: genres and stations are things only it knows about, and browsing
   * directories is a Subsonic call that Jellyfin has no equivalent for. A
   * section that is not here is not greyed out — with no server coming back
   * there is nothing to grey out for (see `useLocalProfile`).
   */
  const subsonic = !!auth && auth.serverType !== 'jellyfin';
  const available = (key: Section): boolean => {
    switch (key) {
      case 'genres':
        return !!auth && !offline;
      case 'radio':
        return subsonic && !offline;
      case 'folders':
        return subsonic && !offline && showFolderBrowser;
      default:
        return true;
    }
  };
  const sections = SECTIONS.filter((s) => available(s.key));
  // Going offline can take the section you were on with it.
  const current = available(section) ? section : 'albums';

  // The inset is read here rather than left to a `SafeAreaView`: that one pads
  // itself once its native view has been measured, and a tab is only mounted
  // the first time it is opened, so its first frame was drawn under the status
  // bar and jumped down right after (see "Your library").
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.safe, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.heading}>{t('Library')}</Text>
        <OfflineIndicator />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.segments}
        contentContainerStyle={styles.segmentsContent}
      >
        {sections.map((s) => {
          const active = s.key === current;
          return (
            <Pressable
              key={s.key}
              style={[styles.segment, active && { backgroundColor: accent }]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => setSection(s.key)}
            >
              <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                {t(s.label)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Only the section on screen is mounted, so nothing else is asking the
          server while you are not looking at it. The cost is that coming back
          to one starts it at the top; the alternative is six lists all live at
          once, which on a big library is what the app spent #50 undoing. */}
      <View style={styles.body}>
        {current === 'albums' ? (
          <AlbumsBrowser embedded />
        ) : current === 'artists' ? (
          <ArtistsBrowser embedded />
        ) : current === 'songs' ? (
          <SongsBrowser embedded />
        ) : current === 'genres' ? (
          <GenresBrowser embedded />
        ) : current === 'radio' ? (
          <RadioBrowser embedded />
        ) : (
          <FoldersBrowser />
        )}
      </View>
    </View>
  );
}

const styles = themed((colors) => ({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  // The same heading "Your library" has, since they are the two halves of one
  // idea and a different size would read as a different kind of screen.
  heading: { color: colors.text, fontSize: 30, fontWeight: '600' },
  segments: { flexGrow: 0, paddingBottom: spacing.md },
  segmentsContent: { gap: spacing.sm, paddingHorizontal: spacing.lg },
  segment: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: 999,
    backgroundColor: colors.surfaceHighlight,
  },
  segmentText: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: '600' },
  segmentTextActive: { color: colors.onAccent },
  body: { flex: 1 },
}));
