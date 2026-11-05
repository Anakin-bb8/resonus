/**
 * Plays a radio station: one song whose stream is the station's. The same
 * from the station list and from search.
 *
 * A Jellyfin station can come without an address of its own (see
 * `getRadioStations` there), in which case it is asked for here, as it is
 * played. If none comes back, a toast says so instead of a player stuck on a
 * stream that is not there.
 */
import { radioStreamUrl, type RadioStation } from '@/api/backend';
import { tg } from '@/i18n';
import { useAuthStore } from '@/store/auth';
import { usePlayerStore } from '@/store/player';
import { useToast } from '@/store/toast';

export async function playRadio(station: RadioStation): Promise<void> {
  const auth = useAuthStore.getState().auth;
  const url = auth ? await radioStreamUrl(auth, station).catch(() => null) : station.streamUrl;
  if (!url) {
    useToast.getState().show(tg("This station can't be played right now"));
    return;
  }
  await usePlayerStore.getState().playQueue(
    [{ id: station.id, title: station.name, url, artist: tg('Radio'), coverArt: station.coverArt }],
    0,
    station.name,
    '/radio',
  );
}
