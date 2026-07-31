/** How an artist's albums split between "Discography" and "Appears on". */
import { type Album, type GuestAlbum } from '@/api/subsonic';

const byYear = (a: Album, b: Album) => (b.year ?? 0) - (a.year ?? 0);

/**
 * Some servers (Navidrome with artist participations on) list collaboration
 * albums inside `getArtist` as well, so "already in the discography" does NOT
 * mean "own album". When the server confirmed a participation we move the
 * album out of the discography instead of dropping it — assuming otherwise is
 * what made "Appears on" never show up on those servers.
 *
 * Shared by the artist screen and the full-list screen so both rows and their
 * "Show all" contain exactly the same albums.
 */
export function splitArtistAlbums(
  albums: Album[],
  guests: GuestAlbum[],
): { own: Album[]; guest: GuestAlbum[] } {
  const confirmedIds = new Set(guests.filter((a) => a.confirmed).map((a) => a.id));
  // Unconfirmed ones are guesses from a name search: there the discography is
  // still the best evidence of what's the artist's own.
  const ownIds = new Set(albums.map((a) => a.id));
  return {
    own: albums.filter((a) => !confirmedIds.has(a.id)).sort(byYear),
    guest: guests.filter((a) => a.confirmed || !ownIds.has(a.id)).sort(byYear),
  };
}
