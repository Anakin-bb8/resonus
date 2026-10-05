/**
 * One radio: what its Home card opens, in the shape its siblings use - the
 * picture edge to edge from the very top of the display, artwork only (the
 * name lives in the title underneath); the radio's colour fading out
 * of it under the title and the buttons; the tracks below; and a short set
 * of suggestions at their foot.
 *
 * The definition comes from what Home saved when it has it, and is built
 * here when it doesn't (a deep link, or the section turned off). What Home
 * saved carries the tracks it opened with, so the list is already full on
 * the first frame; the fresh list follows when the server answers, and the
 * screen plays whichever of the two it has.
 */
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';

import { getArtist } from '@/api/data';
import { AlbumRowsSkeleton } from '@/components/AlbumRowsSkeleton';
import { Message } from '@/components/Message';
import { RadioArt } from '@/components/RadioCard';
import { SuggestedTracks } from '@/components/SuggestedTracks';
import { TrackListView } from '@/components/TrackListView';
import { useScreenSize } from '@/hooks/useScreenSize';
import { songsLabel, useT } from '@/i18n';
import { haptic } from '@/lib/haptics';
import { buildRadioDef, radioTracks } from '@/lib/radioBuild';
import { currentSong, usePlayerStore } from '@/store/player';
import { useRadios, type RadioDef } from '@/store/radios';
import { useSettings } from '@/store/settings';
import { useToast } from '@/store/toast';
import { themed, useTheme } from '@/theme';

/** Fisher–Yates, so shuffle plays this radio's own list in another order
 *  (the queue shows exactly what is playing, which a mode flag wouldn't). */
function shuffled<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function ArtistRadioScreen() {
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  useTheme();
  const { width } = useScreenSize();
  const { id } = useLocalSearchParams<{ id: string }>();
  const radioId = id ?? '';
  const t = useT();
  const toast = useToast((s) => s.show);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const playing = usePlayerStore(currentSong);
  const showListArtwork = useSettings((s) => s.showListArtwork);
  const lang = useSettings((s) => s.language);

  const defQuery = useQuery({
    queryKey: ['radio-def', radioId],
    queryFn: async (): Promise<RadioDef> => {
      const saved = useRadios.getState().defs.find((d) => d.seed.id === radioId);
      if (saved) return saved;
      // Straight into the screen without Home having built anything: make
      // just this one (and leave it out of the store - the section's own
      // refresh decides what belongs there).
      const { artist } = await getArtist(radioId);
      const built = await buildRadioDef({ id: radioId, name: artist.name, coverArt: artist.coverArt });
      if (!built) throw new Error('radio');
      return built;
    },
    staleTime: Number.POSITIVE_INFINITY,
    retry: 1,
  });
  const def = defQuery.data;

  const tracksQuery = useQuery({
    queryKey: ['radio-tracks', radioId],
    queryFn: () => radioTracks(def as RadioDef),
    enabled: !!def,
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });
  // The snapshot Home saved is what the screen wears while the fresh list is
  // being asked for - and stays when it can't be, so a list once seen is
  // never an empty page.
  const tracks = tracksQuery.data ?? def?.tracks ?? [];

  const title = def ? t('The {artist} Radio', { artist: def.seed.name }) : '';
  const href = `/artist-radio/${radioId}`;
  const similarNames = def?.similar
    .slice(0, 3)
    .map((a) => a.name)
    .join(', ');
  // The picture takes the top of the display: 80% of its width, which the
  // list clamps so it always ends a little above where a square cover would
  // have, on any screen there is.
  const coverH = Math.round(width * 0.8);

  const play = (index: number, opts?: { shuffled?: boolean }) => {
    if (tracks.length === 0) return;
    haptic('medium');
    const list = opts?.shuffled ? shuffled(tracks) : tracks;
    void playQueue(list, index, title, href);
  };

  const emptyState =
    defQuery.isLoading || tracksQuery.isLoading ? (
      <AlbumRowsSkeleton />
    ) : defQuery.isError ? (
      <Message text={t("Couldn't build the radio.")} onRetry={() => void defQuery.refetch()} />
    ) : (
      <Message text={t("Couldn't load songs.")} onRetry={() => void tracksQuery.refetch()} />
    );

  return (
    <TrackListView
      title={title}
      subtitle={
        similarNames ? t('With {artists} and more', { artists: similarNames }) : undefined
      }
      meta={tracks.length > 0 ? songsLabel(tracks.length, lang) : undefined}
      accentColor={def?.color}
      songs={tracks}
      currentId={playing?.id}
      showArtwork={showListArtwork}
      wideCover={{
        height: coverH,
        render: (w, h) =>
          def ? (
            <RadioArt def={def} width={w} cropHeight={h} bare />
          ) : (
            <View style={[styles.placeholder, { width: w, height: h }]} />
          ),
      }}
      emptyState={emptyState}
      footer={
        tracks.length > 0 && def ? (
          <SuggestedTracks
            songs={tracks}
            subtitle={t('Based on the tracks in this radio')}
            addLabel={t('Add to queue')}
            onAdd={async (song) => {
              addToQueue(song);
              toast(t('Added to queue'));
              return true;
            }}
          />
        ) : undefined
      }
      onPlay={play}
    />
  );
}

const styles = themed((t) => ({
  placeholder: {
    backgroundColor: t.surface,
  },
}));
