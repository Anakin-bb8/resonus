/**
 * Settings › Quality & playback: streaming bitrate, crossfade and autoplay.
 * Offline, what is server-side stays where it is and is greyed out instead of
 * being taken away, so looking for a setting never ends in an empty screen
 * (#114). Download-related settings live in Settings › Downloads, and lyrics
 * options in Settings › Player.
 */
import { useRouter } from 'expo-router';
import { ScrollView, Text } from 'react-native';

import {
  SelectList,
  SettingRow,
  SettingsPage,
  settingsStyles,
  SliderRow,
  SwitchList,
} from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { formatDuration } from '@/lib/format';
import { useAuthStore } from '@/store/auth';
import {
  BITRATE_OPTIONS,
  clampReplayGainPreamp,
  REPLAY_GAIN_PREAMP_LIMIT,
  SCROBBLE_SECONDS_MAX,
  TRANSCODE_FORMATS,
  useSettings,
} from '@/store/settings';

export default function PlaybackSettings() {
  const t = useT();
  const router = useRouter();
  const offline = useAuthStore((s) => s.offline);
  const maxBitRate = useSettings((s) => s.maxBitRate);
  const setMaxBitRate = useSettings((s) => s.setMaxBitRate);
  const maxBitRateCellular = useSettings((s) => s.maxBitRateCellular);
  const setMaxBitRateCellular = useSettings((s) => s.setMaxBitRateCellular);
  const streamFormat = useSettings((s) => s.streamFormat);
  const setStreamFormat = useSettings((s) => s.setStreamFormat);
  const streamFormatCellular = useSettings((s) => s.streamFormatCellular);
  const setStreamFormatCellular = useSettings((s) => s.setStreamFormatCellular);
  const autoplaySimilar = useSettings((s) => s.autoplaySimilar);
  const setAutoplaySimilar = useSettings((s) => s.setAutoplaySimilar);
  const crossfadeSec = useSettings((s) => s.crossfadeSec);
  const setCrossfadeSec = useSettings((s) => s.setCrossfadeSec);
  const preloadUpcoming = useSettings((s) => s.preloadUpcoming);
  const preferDownloads = useSettings((s) => s.preferDownloads);
  const setPreferDownloads = useSettings((s) => s.setPreferDownloads);
  const setPreloadUpcoming = useSettings((s) => s.setPreloadUpcoming);
  const replayGain = useSettings((s) => s.replayGain);
  const setReplayGain = useSettings((s) => s.setReplayGain);
  const replayGainPreampDb = useSettings((s) => s.replayGainPreampDb);
  const setReplayGainPreampDb = useSettings((s) => s.setReplayGainPreampDb);
  const scrobblePercent = useSettings((s) => s.scrobblePercent);
  const setScrobblePercent = useSettings((s) => s.setScrobblePercent);
  const scrobbleSeconds = useSettings((s) => s.scrobbleSeconds);
  const setScrobbleSeconds = useSettings((s) => s.setScrobbleSeconds);
  const keepScreenAwake = useSettings((s) => s.keepScreenAwake);
  const batteryWarning = useSettings((s) => s.batteryWarning);
  const setBatteryWarning = useSettings((s) => s.setBatteryWarning);
  const setKeepScreenAwake = useSettings((s) => s.setKeepScreenAwake);

  // Only "Original" is a word; the rest are a number and a unit that read the
  // same in every language.
  const bitrateOptions = BITRATE_OPTIONS.map((opt) => ({
    value: opt.value,
    label: opt.value === 0 ? t('Original') : opt.label,
  }));
  const codecOptions = TRANSCODE_FORMATS.map((v) => ({
    value: v,
    label: v === '' ? t('Server default') : v.toUpperCase(),
  }));

  return (
    <SettingsPage title={t('Quality & playback')}>
      <ScrollView contentContainerStyle={settingsStyles.content}>
        {/* The first title sticks to the header (no section margin). */}
        <Text style={[settingsStyles.sectionTitle, { marginTop: 0 }]}>{t('Streaming')}</Text>
        {/* Offline there is no stream, so none of this does anything. It is
            greyed out rather than taken away: a setting that is not where you
            left it sends you hunting through every other screen before you work
            out it was never there (#114). What each one says still holds for
            when the connection is back. A line saying as much used to stand
            here; a whole section in grey already says it, and being told twice
            reads like being talked down to (raised by @ztx-lyghters). */}
        {/* First, because it is the question of whether any of the quality
            settings below apply to a song at all. It used to sit under them,
            which read fine while they were four plain rows; under a heading it
            would have looked like one more mobile data setting. */}
        <SelectList
          label={t('Play downloaded songs from the phone')}
          description={t(
            'A downloaded song normally plays from the file, which costs no data. Choose otherwise if your downloads are smaller copies and you would rather stream the good one when you can. Without a connection the file is always used.',
          )}
          options={[
            { value: 'always', label: t('Always') },
            { value: 'cellular', label: t('On mobile data only') },
            { value: 'original', label: t('Only if it is the original file') },
            { value: 'never', label: t('Never') },
          ]}
          value={preferDownloads}
          onChange={setPreferDownloads}
          disabled={offline}
        />
        <SwitchList
          options={[
            {
              label: t('Preload upcoming tracks'),
              description: t('Request the next few tracks ahead of time so they start instantly. Helps with proxy servers like Octo-Fiesta or slow sources that fetch tracks on demand.'),
              value: preloadUpcoming,
              onChange: setPreloadUpcoming,
              disabled: offline,
            },
          ]}
        />
        {/* One set per network, each under a heading of its own, instead of
            four rows in a row telling them apart by what is in brackets. The
            brackets stay: read on its own, out of the group it is under, a row
            still has to say which network it is about. Last in the section, so
            nothing after them falls under a heading it has nothing to do
            with. */}
        <Text style={settingsStyles.groupTitle}>Wi-Fi</Text>
        <SelectList
          label={t('Streaming quality (Wi-Fi)')}
          description={t(
            '“Original” is the file exactly as it is on the server, with nothing transcoded. A lower bitrate saves data and may cost audible quality.',
          )}
          options={bitrateOptions}
          value={maxBitRate}
          onChange={setMaxBitRate}
          disabled={offline}
        />
        {/* Each codec right under its own quality: the codec only applies
            where a bitrate is set. At "Original" nothing is transcoded, so the
            codec of that network has nothing to do and is greyed out rather
            than silently ignored (#72). */}
        <SelectList
          label={t('Streaming codec (Wi-Fi)')}
          description={
            maxBitRate > 0
              ? t('Codec to transcode to. Your server must support it.')
              : t('Codec to transcode to. At “Original” quality nothing is transcoded.')
          }
          options={codecOptions}
          value={streamFormat}
          onChange={setStreamFormat}
          disabled={offline || maxBitRate === 0}
          // "Not used" is about the quality above being "Original", which is
          // still worth saying offline; being offline is not, or every row in
          // the section would repeat the line already above it.
          disabledLabel={maxBitRate === 0 ? t('Not used') : undefined}
        />
        <Text style={settingsStyles.groupTitle}>{t('Mobile data')}</Text>
        {/* No descriptions in this group on purpose: they would be the same two
            paragraphs as above, in the same section. The Wi-Fi pair explains
            both. */}
        <SelectList
          label={t('Streaming quality (mobile data)')}
          options={bitrateOptions}
          value={maxBitRateCellular}
          onChange={setMaxBitRateCellular}
          disabled={offline}
        />
        <SelectList
          label={t('Streaming codec (mobile data)')}
          options={codecOptions}
          value={streamFormatCellular}
          onChange={setStreamFormatCellular}
          disabled={offline || maxBitRateCellular === 0}
          disabledLabel={maxBitRateCellular === 0 ? t('Not used') : undefined}
        />

        <Text style={settingsStyles.sectionTitle}>{t('Sound')}</Text>
        <SliderRow
          label={t('Crossfade')}
          description={t('Songs blend into each other when one ends.')}
          value={crossfadeSec}
          max={12}
          formatValue={(v) => (v === 0 ? t('No') : `${v} s`)}
          onChange={setCrossfadeSec}
        />
        <SelectList
          label={t('Normalize volume')}
          description={t("Evens out loudness between songs using your files' ReplayGain tags.")}
          options={[
            { value: 'off', label: t('Off') },
            { value: 'auto', label: t('Automatic') },
            { value: 'track', label: t('By track') },
            { value: 'album', label: t('By album') },
          ]}
          value={replayGain}
          onChange={setReplayGain}
        />
        {/* Only with normalization on: with nothing normalizing, there is no
            level to move and the slider would do nothing at all. No description
            either: it sits right under the one that explains normalizing, and a
            paragraph that tall makes the row jump while the slider moves. */}
        {replayGain === 'off' ? null : (
          <SliderRow
            label={t('Pre-amp')}
            value={replayGainPreampDb}
            min={-REPLAY_GAIN_PREAMP_LIMIT}
            max={REPLAY_GAIN_PREAMP_LIMIT}
            step={0.5}
            formatValue={(v) => `${v > 0 ? '+' : ''}${clampReplayGainPreamp(v).toFixed(1)} dB`}
            // The slider covers the whole range in half dB steps; the tenths
            // that a finger can't land on are what the pad is for.
            fineTune={{ step: 0.1, doneLabel: t('Done') }}
            onChange={setReplayGainPreampDb}
          />
        )}
        <SettingRow
          label={t('Equalizer')}
          description={t('Tune the sound band by band.')}
          chevron
          onPress={() => router.push('/settings/equalizer')}
        />

        <Text style={settingsStyles.sectionTitle}>{t('Playback')}</Text>
        <SwitchList
          options={[
            {
              label: t('Autoplay'),
              description: t('Keep playing similar songs when your queue ends. A mix you start yourself always does, even with this off.'),
              value: autoplaySimilar,
              onChange: setAutoplaySimilar,
              // What comes next is the server's idea of similar, so offline
              // there is nothing to ask.
              disabled: offline,
            },
            {
              label: t('Keep screen on'),
              description: t('The screen never turns off while the app is visible.'),
              value: keepScreenAwake,
              onChange: setKeepScreenAwake,
            },
            {
              label: t('Warn about battery optimization'),
              description: t('Check on startup whether Android is restricting the app, which is what usually stops playback in the background.'),
              value: batteryWarning,
              onChange: setBatteryWarning,
            },
          ]}
        />

        {/* Two rules rather than one number: the share of a song is what makes
            a listen mean the same on a two-minute track and on a ten-minute
            one, and the flat time is what keeps the long ones from asking for
            five minutes before they count. Either can be turned off on its
            own, and the earlier of the two is what fires (raised by
            @ztx-lyghters in #126). */}
        <Text style={settingsStyles.sectionTitle}>{t('Scrobbling')}</Text>
        {/* The warning is not "this might not count". It is the opposite, and
            saying it the other way round would be untrue: nothing between here
            and Last.fm checks these numbers, because what arrives there is the
            scrobble and never the position it was sent at. */}
        <Text style={settingsStyles.sectionDescription}>
          {t(
            'A song counts as played once it passes either of these. What counts goes to your server, and from there to Last.fm or ListenBrainz if you have them linked, and none of them can tell how long you actually listened: they take what arrives. Lower these and the songs you skip past will count as played.',
          )}
        </Text>
        <SliderRow
          label={t('Part of the song')}
          value={scrobblePercent}
          max={100}
          step={5}
          formatValue={(v) => (v === 0 ? t('Off') : `${v} %`)}
          fineTune={{ step: 1, doneLabel: t('Done') }}
          onChange={setScrobblePercent}
        />
        {/* Seconds up to a minute, then minutes and seconds: "240 s" is a
            number to work out, and "4:00" is the one people already know as
            the rule both services describe. */}
        <SliderRow
          label={t('Time played')}
          value={scrobbleSeconds}
          max={SCROBBLE_SECONDS_MAX}
          step={5}
          formatValue={(v) => (v === 0 ? t('Off') : v < 60 ? `${v} s` : formatDuration(v))}
          fineTune={{ step: 1, doneLabel: t('Done') }}
          onChange={setScrobbleSeconds}
        />
        {/* Both off is a real choice, not a mistake to be corrected, so it is
            said plainly and nothing is put back. It earns a line because the
            play counts on the server stop too, which is further than someone
            turning off "scrobbling" may have meant to go. */}
        {scrobblePercent === 0 && scrobbleSeconds === 0 ? (
          <Text style={settingsStyles.sectionDescription}>
            {t(
              'With both off nothing is ever reported: not to Last.fm or ListenBrainz, and not to your own server, so these plays stop counting there too.',
            )}
          </Text>
        ) : null}
      </ScrollView>
    </SettingsPage>
  );
}
