/**
 * Server profile network reliability: URL switching and fallback to offline
 * mode, both automatic on connectivity change.
 *
 * A profile can have multiple URLs for the same account (local IP, domain,
 * Tailscale…). On network change —leaving home: Wi-Fi → mobile— active URLs are
 * probed (local network ones first) and the first reachable one is activated.
 * The Wi-Fi SSID is not read (avoids requesting location permission): we are
 * guided by who responds, which is enough because the local IP is only reachable
 * at home.
 *
 * Additionally, if NO URL responds and the user has downloads, it falls back to
 * offline mode (show/play downloads) without them having to do anything; and
 * when the server responds again, it auto-reconnects. This makes downloads
 * "just work" without managing modes. A manual offline is not reverted (only
 * what auto-activated is auto-reconnected: `autoOffline`).
 */
import * as Network from 'expo-network';
import { AppState } from 'react-native';

import { bump } from '@/lib/perfLog';

import { reachable } from '@/api/backend';
import { tg } from '@/i18n';
import { byProbePriority } from '@/lib/serverUrls';
import { useAuthStore } from './auth';
import { hasDownloads } from './downloads';
import { useSettings } from './settings';
import { useToast } from './toast';

let started = false;
let checking = false;
let debounce: ReturnType<typeof setTimeout> | null = null;
/**
 * Consecutive failed probes. Require 2 before falling to offline: a single
 * failure could just be a network hiccup (Wi-Fi↔data handoff, slow DNS…), and
 * we don't want to switch modes for that. Resets as soon as the server responds.
 */
let consecutiveFails = 0;
/**
 * Somebody asked for a probe while one was running. It used to be dropped, and
 * the ones most worth keeping are exactly the ones that arrive then: a screen
 * asks for a probe when its own request comes back with nothing, and by that
 * time a round is usually already in flight. Remembered here and run when the
 * current one is done.
 */
let again = false;

/**
 * Probes the active profile's URLs and acts: switches to the first reachable
 * one, reconnects if we had auto-fallen to offline, or falls to offline if
 * nothing responds.
 */
async function check(): Promise<void> {
  if (checking) {
    again = true;
    return;
  }
  const { auth, offline, autoOffline, hydrating } = useAuthStore.getState();
  // The session is still being read off disk: there is nothing to probe yet,
  // and there will be in a moment, so this waits rather than giving up. A probe
  // dropped here is one nobody asks for again until the network changes, which
  // on a cold start is precisely never.
  if (hydrating) {
    schedule();
    return;
  }
  // No server account (signed out or local profile): nothing to probe.
  if (!auth) return;
  // Offline on purpose: not even the probe. Somebody who turned the mode on by
  // hand said no network, and this ran on every network change and at every
  // cold start, which is what made a manually offline app talk to the server
  // before it had drawn a screen (#89). An automatic offline is the opposite
  // case: the probe is the only way back, so it keeps going.
  if (offline && !autoOffline) return;
  const urls = auth.urls ?? [auth.serverUrl];
  checking = true;
  try {
    let up: string | null = null;
    for (const url of byProbePriority(urls)) {
      if (await reachable(auth, url)) {
        up = url;
        break;
      }
    }
    // Profile may have changed while probing: revalidate against live state.
    const now = useAuthStore.getState();
    if (!now.auth) return;
    // Automatic online↔offline change: the user can disable it to control the
    // mode manually. URL switching (autoUrl) is separate and not gated.
    const autoSwitch = useSettings.getState().autoOfflineSwitch;
    if (up) {
      consecutiveFails = 0;
      if (now.autoOffline && autoSwitch && canSwitchMode()) {
        // We had auto-fallen to offline: server is back → reconnect.
        // First online, then (if applicable) set the reachable URL, already in
        // online context so track reload works properly.
        await now.goOnline();
        if (up !== now.auth.serverUrl && now.auth.urls?.includes(up)) {
          await now.setActiveUrl(up);
        }
        // Cross-screen notification (visible on any screen, not just Home).
        useToast.getState().show(tg('Back online'));
      } else if (
        !now.offline &&
        now.auth.autoUrl &&
        urls.length >= 2 &&
        up !== now.auth.serverUrl &&
        now.auth.urls?.includes(up)
      ) {
        // Normal URL switching (same different network: local ↔ remote).
        await now.setActiveUrl(up);
      }
    } else if (!now.offline && autoSwitch && (await hasDownloads())) {
      // No server responds and there are downloads. We confirm with a 2nd probe
      // before falling to offline (a stray failure could be a hiccup). Without
      // downloads it stays online (the UI already warns); falling to an empty
      // library would be worse than the warning.
      consecutiveFails += 1;
      if (consecutiveFails >= 2 && canSwitchMode()) {
        consecutiveFails = 0;
        await now.goOffline(true);
        useToast.getState().show(tg('Offline'));
      } else {
        schedule(); // re-probes shortly to confirm
      }
    }
  } finally {
    checking = false;
    if (again) {
      again = false;
      schedule();
    }
  }
}

/**
 * How long the mode has to stay where it is, whatever the network does.
 *
 * Two failed probes are already required before falling offline, but nothing
 * stopped the app from falling and coming back and falling again on a server
 * that answers every other time. Each of those rounds writes what was browsed
 * into the mirror and then marks everything stale, so everything on screen is
 * fetched again: on a large library that is not free, and it happens with
 * nobody touching anything.
 *
 * A switch asked for by hand, from Settings, does not come through here and is
 * never held back.
 */
const MODE_COOLDOWN_MS = 60_000;
let lastModeSwitch = 0;

function canSwitchMode(): boolean {
  if (Date.now() - lastModeSwitch < MODE_COOLDOWN_MS) {
    // Counted, or fixing this would take the evidence with it: a report has to
    // still be able to say that the app wanted to flap and was not allowed to.
    bump('offline · switch held back');
    return false;
  }
  lastModeSwitch = Date.now();
  return true;
}

/** Re-schedules the probe after a breather (Wi-Fi→data handoff takes time to settle). */
function schedule(): void {
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(() => void check(), 1500);
}

/** Starts the watcher (idempotent; from the root layout, after hydration). */
export function initAutoUrl(): void {
  if (started) return;
  started = true;
  Network.addNetworkStateListener(() => schedule());
  // And whenever the app is opened again, which is not the same event. What
  // makes a server unreachable can perfectly well happen while nobody is
  // looking —a VPN dropped, a tunnel that expired, a server rebooted— and none
  // of that changes the phone's network, so the listener above never fires and
  // nothing else asks either: the effects that probe on startup only run when
  // the app starts. That leaves an app whose process outlived the trip asking a
  // server that is not there: the spinner, and then the message saying it could
  // not be reached, with the downloads sitting right there (#122).
  AppState.addEventListener('change', (state) => {
    if (state === 'active') schedule();
  });
  // Initial check (when opening the app we may already not be at home).
  schedule();
}

/** Forces a probe now (e.g. when enabling switching in Settings). */
export function checkAutoUrlNow(): void {
  schedule();
}
