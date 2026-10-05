/**
 * Rewrites the system's deep links before expo-router gets to resolve them.
 *
 * react-native-track-player opens the app, on notification tap, with the link
 * `trackplayer://notification.click` (and `trackplayer://service-bound` when
 * binding the service). Those routes don't exist and would show "Unmatched
 * Route", so the notification tap is routed to the player.
 *
 * A launcher shortcut (`resonus://shortcut/<action>`) goes through `/shortcut`.
 * The home screen widget links deeper (`resonus://album/<id>`), which is the
 * app's own scheme and so a path as soon as the scheme is taken off.
 */

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    if (path.includes('notification.click')) return '/player';
    // Other internal RNTP intents: to the main screen instead of failing.
    if (path.includes('trackplayer://')) return '/';
    // A launcher shortcut (see `lib/homeWidget`).
    const shortcut = path.match(/shortcut\/([a-z-]+)/);
    if (shortcut) return `/shortcut?action=${shortcut[1]}`;
    // Anything else under our own scheme: the widget's links, and bare
    // `resonus://` back to the start.
    if (path.startsWith('resonus://')) return `/${path.slice('resonus://'.length)}`;
    return path;
  } catch {
    return '/';
  }
}
