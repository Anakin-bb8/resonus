/**
 * Settings › Diagnostics: what has been keeping the JS thread busy.
 *
 * Reachable by tapping the version five times in About, because it is for
 * chasing a report, not for browsing. The share button hands over the same
 * thing as plain text, which is easier to paste into an issue than a
 * screenshot is to read.
 */
import Constants from 'expo-constants';
import { useRootNavigationState } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Share, Text, View } from 'react-native';

import { COVER, songCoverUrl, songListSorts } from '@/api/data';
import { SettingRow, SettingsPage, settingsStyles } from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { coverSourceOf, mirrorCoverState } from '@/lib/mirrorCovers';
import {
  formatMs,
  perfAway,
  perfBlocks,
  perfCounts,
  perfNet,
  perfOps,
  perfReport,
  perfSince,
  perfTime,
  resetPerfLog,
} from '@/lib/perfLog';
import { repairStatus } from '@/lib/navidromeRepair';
import { useAuthStore } from '@/store/auth';
import { anyDownloads, useDownloads } from '@/store/downloads';
import { useJukebox } from '@/store/jukebox';
import { currentSong, usePlayerStore } from '@/store/player';
import { useUpnp } from '@/store/upnp';
import { useSettings } from '@/store/settings';
import { enabledFolderIds } from '@/store/libraries';
import { fontSize, spacing, themed, useTheme } from '@/theme';

/** Stamped in by the workflow that builds the APK; empty when run locally. */
const COMMIT = (process.env.EXPO_PUBLIC_COMMIT ?? '').slice(0, 7);

export default function DiagnosticsSettings() {
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  useTheme();
  const t = useT();
  // Nothing here is reactive: it is a snapshot, refreshed by pulling or by
  // resetting, so reading it doesn't add work of its own.
  const [tick, setTick] = useState(0);
  const blocks = perfBlocks();
  // What the profile is, in the terms the code asks about it. Half the reports
  // that start with "this doesn't show up for me" end here.
  const auth = useAuthStore((s) => s.auth);
  const offline = useAuthStore((s) => s.offline);
  const folderFilter = enabledFolderIds(auth);
  const nets = perfNet();
  const time = perfTime();
  const netCalls = nets.reduce((n, x) => n + x.calls, 0);
  const netKb = Math.round(nets.reduce((n, x) => n + x.bytes, 0) / 1024);
  const costly = useSettings((st) =>
    [
      st.preloadUpcoming && 'preload',
      st.crossfadeSec > 0 && `crossfade ${st.crossfadeSec}s`,
      st.autoplaySimilar && 'autoplay',
      st.autoOfflineSwitch && 'auto offline',
      st.syncQueueFromServer && 'queue sync',
      st.animatedCoverBackground && 'animated cover',
      st.updateCheck && 'update check',
    ]
      .filter(Boolean)
      .join(', '),
  );
  // Read one at a time rather than as an object: a selector that builds one
  // hands back a new reference on every store write, and this screen would
  // then repaint on every beat of the player it is measuring.
  const queueLen = usePlayerStore((st) => st.queue.length);
  const queueIndex = usePlayerStore((st) => st.index);
  const repeat = usePlayerStore((st) => st.repeat);
  const shuffle = usePlayerStore((st) => st.shuffle);
  const radioMode = usePlayerStore((st) => st.radioMode);
  const upnpOn = useUpnp((st) => st.connected);
  const jukeboxOn = useJukebox((st) => st.active);
  const downloading = useDownloads((st) => Object.keys(st.active).length);
  const profileLines = [
    // Which build this is, since a test APK carries the same version as the
    // release it was branched from and there is otherwise no telling them
    // apart from inside the app.
    `build: ${Constants.expoConfig?.version ?? '?'}${COMMIT ? ` (${COMMIT})` : ' (local)'}`,
    `type: ${auth?.serverType ?? '—'}`,
    `native password: ${auth?.ndPassword || auth?.password ? 'yes' : 'no'}`,
    `plain auth: ${auth?.plainAuth ? 'yes' : 'no'}`,
    `library filter: ${folderFilter ? folderFilter.join(', ') : 'none'}`,
    `offline: ${offline ? 'yes' : 'no'}`,
    // Navidrome 0.64 renumbers every id and this is what repaired it. Silent
    // everywhere else, so this line is the only way to tell what it did.
    `id repair: ${repairStatus()}`,
    `song sorts: ${(auth || offline ? songListSorts() : []).join(', ') || '—'}`,
    // The switches that cost something while nobody is looking. Half of what a
    // battery report blames on a version turns out to be a setting somebody
    // turned on, and asking about them one at a time is three round trips on
    // an issue.
    `costly settings: ${costly || 'none'}`,
  ];
  const ops = perfOps();
  const away = perfAway();
  const counts = perfCounts();
  const enabled = useSettings((s) => s.diagnostics);
  const covers = mirrorCoverState();
  const downloads = useDownloads((s) => Object.keys(s.files).length);
  const hydrated = useDownloads((s) => s.hydrated);
  const anyDl = useDownloads(anyDownloads);
  // How deep the stack is. Screens you left stay mounted, which is what makes
  // going back instant and what made the app slow down the more you opened
  // before they were frozen: a number here would have said so in a sentence.
  const navState = useRootNavigationState();
  /**
   * How the cover of what is playing was arrived at.
   *
   * A wrong cover over the right title is not the queue being wrong, it is the
   * picture being looked up by an id that leads somewhere else. Three things
   * can happen and the app kept no record of which: the file saved under this
   * very id, a file saved under ANOTHER id that this one borrows, or nothing
   * local and the server asked directly. Only the middle one can hand back a
   * picture that belongs to something else, so the id it borrowed from is the
   * answer.
   *
   * `coverId` is worked out the way `songCoverUrl` works it out, which is the
   * whole point: reading a different id here would describe a lookup nobody
   * made.
   */
  const playing = usePlayerStore(currentSong);
  const coverId = playing
    ? (playing.coverArt ?? (playing.url ? undefined : playing.albumId))
    : undefined;
  const coverUrl = playing ? songCoverUrl(playing, COVER.card) : undefined;
  const coverLines = playing
    ? [
        `playing: ${playing.title}${playing.album ? ` · ${playing.album}` : ''}`,
        `cover id: ${coverId ?? '—'} (${coverSourceOf(coverId)})`,
        `cover from: ${
          coverUrl
            ? coverUrl.startsWith('file://')
              ? `file ${coverUrl.split('/').pop()}`
              : 'the server'
            : 'nothing'
        }`,
        `song ids: coverArt ${playing.coverArt ?? '—'} · album ${playing.albumId ?? '—'}`,
      ]
    : [];
  const stateLines = [
    // The denominator for every count below. A hundred of anything is one
    // story over ten minutes and another over a night, and the split says
    // which side of the screen going off it happened on.
    `on screen: ${formatMs(time.foregroundMs)} · away: ${formatMs(time.backgroundMs)} · ${time.trips} trips`,
    // Out there the JS thread should barely be run at all. If this is most of
    // the time away, something is keeping it busy with nobody watching.
    `js while away: ${formatMs(time.jsAwayMs)}`,
    // A mix grows on its own and the whole queue is pushed to the server every
    // twenty seconds, so its length is a cost rather than a curiosity.
    `queue: ${queueLen} · at ${queueIndex}${radioMode ? ' · mix' : ''} · repeat ${repeat}${shuffle ? ' · shuffle' : ''}`,
    `output: ${upnpOn ? 'upnp' : jukeboxOn ? 'jukebox' : 'phone'}`,
    `downloads: ${hydrated ? downloads : 'loading'}${anyDl && !hydrated ? ' (some)' : ''}${downloading > 0 ? ` · ${downloading} running` : ''}`,
    `mirror covers: ${covers.saved} saved, ${covers.aliases} other names`,
    `screens open: ${navState?.routes?.length ?? '—'}`,
    ...coverLines,
  ];
  const minutes = Math.max(1, Math.round((Date.now() - perfSince()) / 60000));

  return (
    <SettingsPage title={t('Diagnostics')}>
      <ScrollView
        contentContainerStyle={settingsStyles.content}
        // Any scroll refreshes the numbers; no timer polling behind this.
        onScrollEndDrag={() => setTick(tick + 1)}
      >
        {/* The measurements are in English in every language, on purpose, and
            kept out of `t()` so no locale can translate them: they end up in
            GitHub issues, often as a screenshot, read by people who don't speak
            every language we ship. The shared report is English for the same
            reason. */}
        <Text style={settingsStyles.sectionDescription}>
          {enabled
            ? `Measured over the last ${minutes} min of use.`
            : t('Measuring is off (Settings › About), so there is nothing to show.')}
        </Text>

        <Text style={settingsStyles.sectionTitle}>{t('Profile')}</Text>
        {profileLines.map((line) => (
          <Text key={line} style={styles.line}>
            {line}
          </Text>
        ))}

        <Text style={settingsStyles.sectionTitle}>{t('State')}</Text>
        {stateLines.map((line) => (
          <Text key={line} style={styles.line}>
            {line}
          </Text>
        ))}

        {nets.length > 0 ? (
          <>
            <Text style={settingsStyles.sectionTitle}>{t('Requests')}</Text>
            <Text style={settingsStyles.sectionDescription}>
              {t(
                'Everything asked of the server, most often first. The music itself is not here: the player opens that connection and this never sees it.',
              )}
            </Text>
            <Text style={styles.line}>{`${netCalls} in total · ${netKb} KB declared`}</Text>
            {nets.map((n) => (
              <View key={n.tag} style={styles.row}>
                <Text style={styles.tag} numberOfLines={1}>
                  {n.tag}
                </Text>
                <Text style={styles.value}>
                  {n.calls}× · {Math.round(n.bytes / 1024)} KB
                </Text>
              </View>
            ))}
          </>
        ) : null}

        <Text style={settingsStyles.sectionTitle}>Interface freezes</Text>
        <Text style={settingsStyles.sectionDescription}>
          Moments when the app stopped responding, longest first.
        </Text>
        {blocks.length === 0 ? (
          <Text style={styles.line}>None over 120 ms.</Text>
        ) : (
          blocks.map((b, i) => (
            <Text key={i} style={styles.line}>
              {b.ms} ms · {b.during}
            </Text>
          ))
        )}

        <Text style={settingsStyles.sectionTitle}>Time spent</Text>
        {ops.length === 0 ? (
          <Text style={styles.line}>Nothing measured yet.</Text>
        ) : (
          ops.slice(0, 20).map((o) => (
            <View key={o.tag} style={styles.row}>
              <Text style={styles.tag} numberOfLines={1}>
                {o.tag}
              </Text>
              <Text style={styles.value}>
                {o.count}× · {o.totalMs} ms · {o.maxMs} ms
              </Text>
            </View>
          ))
        )}

        {away.length > 0 ? (
          <>
            <Text style={settingsStyles.sectionTitle}>{t('While minimized')}</Text>
            <Text style={settingsStyles.sectionDescription}>
              {t(
                'The player keeps beating twice a second while the app is away. Long silences here mean the app stopped following what it was playing.',
              )}
            </Text>
            {away.map((a) => (
              <View key={a.tag} style={styles.row}>
                <Text style={styles.tag} numberOfLines={2}>
                  {a.tag}
                </Text>
                <Text style={styles.value}>
                  {a.count}× · {a.maxMs} ms
                </Text>
              </View>
            ))}
          </>
        ) : null}

        {counts.length > 0 ? (
          <>
            <Text style={settingsStyles.sectionTitle}>{t('Counted')}</Text>
            <Text style={settingsStyles.sectionDescription}>
              {t('What happened, rather than how long it took.')}
            </Text>
            {counts.map((c) => (
              <View key={c.tag} style={styles.row}>
                <Text style={styles.tag} numberOfLines={1}>
                  {c.tag}
                </Text>
                <Text style={styles.value}>{c.n}</Text>
              </View>
            ))}
          </>
        ) : null}

        <SettingRow
          icon="share-outline"
          label={t('Share report')}
          onPress={() =>
            void Share.share({
              message: `${profileLines.join('\n')}\n${stateLines.join('\n')}\n\n${perfReport()}`,
            })
          }
        />
        <SettingRow
          icon="refresh"
          label={t('Start over')}
          onPress={() => {
            resetPerfLog();
            setTick(tick + 1);
          }}
        />
      </ScrollView>
    </SettingsPage>
  );
}

const styles = themed((colors) => ({
  line: { color: colors.textSecondary, fontSize: fontSize.sm, paddingVertical: 2 },
  row: { flexDirection: 'row', gap: spacing.md, paddingVertical: 2 },
  tag: { color: colors.text, fontSize: fontSize.sm, flex: 1 },
  value: { color: colors.textSecondary, fontSize: fontSize.sm },
}));
