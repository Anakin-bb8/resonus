/**
 * Settings › Song menu: which actions appear when tapping the ⋯ of a song.
 *
 * Only toggles, no dragging: the menu order is set by the code (organizing,
 * navigating, playback…) and can't be changed.
 *
 * Note: hiding an action doesn't disable it in the rest of the app. «Add to
 * queue» and «Favorites», for example, are still available in the swipe
 * gesture.
 */
import { ScrollView } from 'react-native';

import { SettingsPage, settingsStyles, SwitchList } from '@/components/SettingsUI';
import { useCanShare } from '@/hooks/useCanShare';
import { useLocalProfile } from '@/hooks/useLocalProfile';
import { useT } from '@/i18n';
import { useAuthStore } from '@/store/auth';
import { useSettings, type SongMenuActionKey } from '@/store/settings';
import { useTheme } from '@/theme';

/** Label (i18n key) of each action. The same ones rendered in the menu. */
const LABEL: Record<SongMenuActionKey, string> = {
  playlist: 'Add to a playlist',
  artist: 'Go to artist',
  album: 'Go to album',
  lyrics: 'Lyrics',
  mix: 'Start mix',
  playNext: 'Play next',
  queue: 'Add to queue',
  favorite: 'Add to favorites',
  rating: 'Rate',
  download: 'Download',
  export: 'Export',
  share: 'Share',
  sleepTimer: 'Sleep timer',
  info: 'Song information',
};

/**
 * Toggle order = actual menu order, to recognize it at a glance. The menu opens
 * showing about the first ten and the rest come with a scroll, so this list
 * also says which ones need a scroll to reach.
 */
const ORDER: SongMenuActionKey[] = [
  'playlist',
  'playNext',
  'queue',
  'favorite',
  'album',
  'artist',
  'download',
  'export',
  'lyrics',
  'mix',
  'rating',
  'share',
  'sleepTimer',
  'info',
];

export default function SongMenuSettings() {
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  useTheme();
  const t = useT();
  const offline = useAuthStore((s) => s.offline);
  const songMenuActions = useSettings((s) => s.songMenuActions);
  const setSongMenuAction = useSettings((s) => s.setSongMenuAction);
  const canShare = useCanShare();
  const local = useLocalProfile();
  // «Start mix» and «Rate» need a server (similar tracks and rating are its
  // idea), so offline their toggles are greyed out: the menu will not show
  // them, but the list of what the menu can hold is the same list either way
  // (#114). «Download» stays on: offline with an account it controls «Remove
  // download».
  //
  // «Share» is different, and stays out: a server that does not offer sharing
  // at all is not a mode you come back from. The local profile is the same
  // case for four of them at once — there is no server to rate against or ask
  // for a mix, and nothing to download or export, since the music is already
  // the phone's own files. A switch for a menu entry that can never be drawn
  // is a switch that does nothing.
  const order = ORDER.filter(
    (key) =>
      !(key === 'share' && !canShare) &&
      !(local && (key === 'mix' || key === 'rating' || key === 'download' || key === 'export')),
  );

  return (
    <SettingsPage title={t('Song menu')}>
      {/* `SettingsPage` renders its children as-is: the margin is set by this
          ScrollView, like the rest of Settings. And with ten toggles you need
          to be able to scroll on shorter screens or with large text. */}
      <ScrollView contentContainerStyle={settingsStyles.content}>
        <SwitchList
          options={order.map((key) => ({
            label: t(LABEL[key]),
            value: songMenuActions[key],
            onChange: (v: boolean) => setSongMenuAction(key, v),
            disabled: offline && (key === 'mix' || key === 'rating'),
          }))}
        />
      </ScrollView>
    </SettingsPage>
  );
}
