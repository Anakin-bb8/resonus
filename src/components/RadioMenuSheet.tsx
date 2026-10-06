/**
 * The ⋯ menu of a radio: its songs into the queue or into a new playlist, a
 * fresh draw of this one radio, and its artist. Opened from the radio screen's
 * ⋯ and from a long press on a Home card, so it is mounted once (in the root
 * layout) and opened with `openRadioMenu`.
 */
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text } from 'react-native';

import { addToPlaylist, createPlaylist, type Song } from '@/api/data';
import Icon from '@/components/Icon';
import { useT } from '@/i18n';
import { radioTracks } from '@/lib/radioBuild';
import { usePlayerStore } from '@/store/player';
import { useRadios, type RadioDef } from '@/store/radios';
import { useToast } from '@/store/toast';
import { colors, fontSize, spacing, themed } from '@/theme';
import { SheetModal } from './SheetModal';

let openMenu: ((def: RadioDef, songs: Song[]) => void) | null = null;

/** Opens the menu for `def`, acting on `songs` (the list the screen shows). */
export function openRadioMenu(def: RadioDef, songs: Song[]): void {
  openMenu?.(def, songs);
}

export function RadioMenuSheet() {
  const t = useT();
  const toast = useToast((s) => s.show);
  const queryClient = useQueryClient();
  const queueMany = usePlayerStore((s) => s.queueMany);
  const openRef = useRef<() => void>(() => {});
  const [target, setTarget] = useState<{ def: RadioDef; songs: Song[] } | null>(null);

  useEffect(() => {
    openMenu = (def, songs) => {
      setTarget({ def, songs });
      openRef.current();
    };
    return () => {
      openMenu = null;
    };
  }, []);

  const title = target ? t('{artist} Radio', { artist: target.def.seed.name }) : '';

  async function saveAsPlaylist(def: RadioDef, songs: Song[]) {
    try {
      const id = await createPlaylist(t('{artist} Radio', { artist: def.seed.name }));
      for (const s of songs) await addToPlaylist(id, s.id);
      void queryClient.invalidateQueries({ queryKey: ['playlists'] });
      toast(t('Playlist created'));
    } catch {
      toast(t("Couldn't create the playlist"));
    }
  }

  async function refresh(def: RadioDef) {
    try {
      const tracks = await radioTracks(def);
      if (tracks.length === 0) throw new Error('empty');
      const { defs, setDefs } = useRadios.getState();
      if (defs.some((d) => d.seed.id === def.seed.id)) {
        await setDefs(defs.map((d) => (d.seed.id === def.seed.id ? { ...d, tracks } : d)));
      } else {
        // Built on the screen and never saved (a deep link): the list lives in
        // that screen's query.
        queryClient.setQueryData(['radio-tracks', def.seed.id], tracks);
      }
      toast(t('Radio updated'));
    } catch {
      toast(t("Couldn't refresh the radio"));
    }
  }

  const row = (icon: keyof typeof Icon.glyphMap, label: string, onPress: () => void) => (
    <Pressable
      key={label}
      style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
      onPress={onPress}
    >
      <Icon name={icon} size={24} color={colors.text} />
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );

  return (
    <SheetModal openRef={openRef}>
      {(close) => {
        if (!target) return null;
        const { def, songs } = target;
        return (
          <>
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
            {row('play-forward', t('Play next'), () => {
              close();
              queueMany(songs, 'next');
              toast(t('Playing next'));
            })}
            {row('list', t('Add to queue'), () => {
              close();
              queueMany(songs, 'end');
              toast(t('Added to queue'));
            })}
            {row('add', t('Save as playlist'), () => {
              close();
              void saveAsPlaylist(def, songs);
            })}
            {row('refresh-outline', t('Refresh this radio'), () => {
              close();
              void refresh(def);
            })}
            {/* After the sheet is off screen: pushing while its Modal is still
                up races the two (see SheetModal). */}
            {row('person-outline', t('Go to artist'), () =>
              close(() => router.push(`/artist/${def.seed.id}`)),
            )}
          </>
        );
      }}
    </SheetModal>
  );
}

const styles = themed((t) => ({
  title: {
    color: t.text,
    fontSize: fontSize.lg,
    fontWeight: '700',
    paddingBottom: spacing.sm,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.md,
  },
  actionText: { color: t.text, fontSize: fontSize.md },
}));
