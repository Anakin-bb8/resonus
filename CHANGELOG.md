# Changelog

All notable changes to Resonus are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Releases before 0.2.1 are only listed on the
[GitHub releases page](https://github.com/juananzzz/resonus/releases).

## [Unreleased]

### Changed

- The language can be changed from the first screen, before signing in. It was
  only in Settings, which is behind a profile, so somebody who could not read
  the sign-in screen had to get past it in a language they do not speak in
  order to change the language of it. The button sits in the corner and says
  the current language in its own name, and the list gives each one in its own
  too.

- German is complete, and reads better than it did: the strings that were still
  in English are translated, and a good number of the ones that were not have
  been reworded to say the same thing in plainer German, with the technical
  words swapped for the ones people use. Thanks to @CraftoHohenvels.

- The player no longer labels a song "Lossless" or "Hi-Res". The line under the
  cover still says the format, the bitrate and the sample rate, which is the
  same information without the verdict on top of it. The argument, made by
  @ztx-lyghters and @CraftoHohenvels on Discord, is that the badge tells whoever
  already reads sample rates nothing they cannot see, and tells everybody else
  that one file is simply better than another, which is how a person ends up
  filling a phone with copies they cannot hear the difference in. Contributed by
  @CraftoHohenvels (#125).

### Fixed

- Lyrics opened part way through a song already show the line that is playing.
  They used to sit at the top until the song moved on a line, and only then
  travel down all at once. The scroll waits to be told where that line is, and
  the lines report it into a place that re-renders nothing, so when the answer
  arrived nobody was listening any more and the next line change was the first
  thing to run it again. The measurement now says so itself, and that first
  positioning is a jump rather than a ride down past everything that has
  already been sung. Line to line stays animated. Reported by @juananzzz.

- The player stops jumping when it opens with the star rating on. The row of
  stars is measured on the first pass and its height is taken off the cover, so
  until it had been measured the cover was drawn a row too tall and then shrank,
  taking the stars with it. The cover was already held back until its slot was
  settled; the stars were not, and they were shown from the first frame, which
  is why they were the part that visibly moved. Both now wait for the same
  thing, and there is one place that decides when that is. Reported by
  @juananzzz.

- Starting a mix stops saying it found nothing while the mix plays. Loading the
  song sends one round of the search off on its own, and "start mix" then asked
  again so it could tell you whether anything turned up: the second ask saw the
  first had already claimed that song and came back empty, which is what the
  message was reporting, a moment before the first round arrived and filled the
  queue. It now waits for the round already in the air, so the answer is the
  real one. Reported by @juananzzz.

- Shuffle stays on. Two things were turning it off by themselves: emptying the
  queue, through a rule written for changing account, where the modes belong
  with the profile that is leaving and its own saved queue; and starting any
  album or playlist, which played it in order however the button was set. So a
  setting that survives closing the app was lost to the most ordinary thing
  there is, which is tapping an album. A list started with shuffle on is now
  dealt: the song you tapped plays first and the rest follow in a new order,
  the same as the button does, and turning shuffle off puts the album back in
  its own order. Reported by @ztx-lyghters (#102).

- A song played away from the network reaches the server when it comes back,
  even if the app never noticed it had lost it. Listens were only put in the
  outbox while offline mode was on, and that mode is a guess: it takes two
  failed probes to change its mind, and it will not change it at all on a
  profile with nothing downloaded to fall back to. Every listen in that gap
  went to a request nobody was waiting on and disappeared the moment it failed,
  which is a whole trip's music on a profile without downloads. A listen the
  network refuses now goes into the same outbox an offline one goes into, with
  the time it happened. Reported by @CraftoHohenvels and confirmed by
  @ztx-lyghters (#126).

- The outbox stops losing what it was given before it had finished loading.
  It is read off disk a few seconds after launch, and until then it wrote
  nothing and then replaced whatever had piled up in memory with the file that
  did not know about it. A queue restored mid-song can cross the halfway mark
  in those seconds, so it was a real listen each time.

- On Jellyfin, a favourited artist no longer says it has no albums. Jellyfin
  does not put counts on an item unless they are asked for, and nothing asked,
  so every artist arrived without one and every row read "0 albums": in
  favourites, in the library, in a search and under similar artists. The four
  requests that fetch artists now ask for the count, and the artist's own screen
  takes it from the albums it has just fetched, so that one is right whatever
  the server fills in. Reported by @jaredm4 (#129).

- Turning the Wi-Fi back on brings the app back online. It went offline by
  itself when the connection dropped, which was the half that worked, and then
  stayed there: a rule added to stop the mode flapping made it hold still for a
  minute after every change, and the moment the server answered again fell
  inside that minute. The switch was refused, nothing asked a second time, and
  the app sat in offline mode with the Wi-Fi visibly back on until it was
  reopened. Coming back is no longer held back at all, and the rule still does
  its job, since a return only ever follows a fall and the fall is still gated.
  A fall that does get held back is now retried instead of dropped. Found from a
  diagnostics report by @juananzzz on 0.6.3 (#122).

## [0.6.3] - 2026-08-05

This one is mostly about what the app does when the server is not there.

Nothing disappears from Settings any more. Streaming quality and its codec,
everything about downloading, autoplay, folder browsing, the chips on Home:
all of it used to vanish without a connection, so looking for a setting meant
walking through every screen that could plausibly hold it before working out
that it had never been there. It all stays in its place now, dimmed and not
answering. Server addresses go one better and still work, because a wrong
address is exactly the kind of thing that puts the app offline, and that screen
was hidden behind the problem it exists to fix.

Falling to offline mode notices more, too. It used to look only when the app
started and when the phone's network changed, and a VPN going down while you
were away is neither, so coming back left the app asking a server that was not
there. And a downloaded song can be dragged through: a download made at a
bitrate is a transcode with no index in it, and the player was answering every
seek by starting the track over, in the car as well as in the app.

The rest is tidying. Streaming settings are two named sets, Wi-Fi and mobile
data, instead of four rows you told apart by reading to the end of each label;
Appearance is a screenful shorter; the lyrics screen comes with the blurred
artwork behind it, like the player it opens from; and "Playing from" stops
naming an album once the queue has grown past it into a mix. Casting to a Sonos
that is grouped, or is one half of a stereo pair, should work, fixed without a
Sonos to try it on.

### Added

- A way to support Resonus, at the bottom of Settings › About. The app asks for
  nothing to work and that is not changing; this is one row, out of the way of
  everything else, for whoever wants to.

### Fixed

- Dragging the slider on a downloaded song no longer starts it again from the
  beginning. A server transcoding on the fly writes into a pipe, so what comes
  out is a bare run of frames with no index in it: Navidrome's AAC is raw ADTS,
  and an MP3 made that way carries a header it never got to go back and fill
  in. Downloading at a bitrate saves exactly that on the phone, and the player
  will not seek a file it cannot index. It answered every seek by starting the
  track over, in the app and in the car alike. Those files are now seeked by
  working out where a second lives from the length of the file and the bitrate,
  which is only consulted when the file itself offers nothing better, so
  anything with a seek table of its own keeps using it. Downloads made without
  a bitrate limit are the server's own file and were never affected. Reported
  by @CraftoHohenvels (#123).

- Automatic offline mode also looks when the app is opened again. What makes a
  server unreachable usually happens while nobody is watching —a VPN dropped, a
  tunnel expired, a server rebooted— and none of that changes the phone's
  network, so the watcher that probes on a network change never heard about it,
  and the only other probe runs when the app starts. An app whose process
  outlived the trip was left asking a server that was not there: the spinner,
  and then the message saying it could not be reached, with the downloads
  sitting right there. It now probes when the app comes to the foreground too,
  a probe asked for while another one is running is no longer dropped but run
  after it, which is exactly when a screen asks for one, and one asked for
  before the session has been read off disk waits for it instead of being
  thrown away. Reported by @CraftoHohenvels (#122).

- Casting to a Sonos speaker that is grouped, or is one half of a stereo pair,
  should work. Those speakers are driven through one of them, and the others
  are perfectly happy to be discovered, to appear in the list and to answer for
  their volume, and then refuse to be handed a track: casting to whichever one
  was not in charge failed every time with nothing to say about why. Which one
  it is comes from the group topology, which is now asked for, and only after a
  refusal, so a speaker that took the track never pays for the question. A
  renderer that turns down the track description is also offered the track
  without it, since the description is what tells it the track is audio and not
  a video, and it is better to lose it than the song. Reported by @hui1848
  (#121), fixed without a Sonos to try it on.

- The battery optimization warning stops coming back after leaving a profile and
  going back in. It is meant to ask once per launch, and answering it, or
  turning it off in Settings › Playback, is meant to be the end of it. But it is
  only on screen with a profile open, so it was built again on the way back in,
  and at that moment the settings on hand are still the ones of the profile that
  left, or the factory ones: it asked again, against an answer it could not see.
  It now counts the launch rather than the screen, and the settings say plainly
  that they are not the new profile's yet until they have been read.

- The player stays at the same height from one song to the next. The room for
  the lyrics card peeking below was only kept for songs that actually had
  lyrics, so skipping through a queue where some do and some don't resized the
  cover and slid the title, the slider and the controls up and down on every
  track. The room is now kept for every song that could have lyrics, and what
  is under a song without them is a strip of empty background, which is quieter
  than the whole screen moving.

### Changed

- Streaming settings come in two named sets, Wi-Fi and mobile data, instead of
  four rows in a row that you told apart by reading to the end of each label.
  The labels keep saying which network they are about, since a row read on its
  own still has to. What decides whether a downloaded song streams at all, and
  the preloading, now come first: they are not about either network, and under
  a heading they would have looked like they were.

- Settings › Appearance is shorter. What a song shows in a list, seven switches
  with a line of explanation each, was a screenful sitting in the middle of it,
  between the language and the navigation bar, so everything below was a scroll
  away for anyone who had not come looking for exactly that. It is now a row
  that opens its own screen, "Song lists", like the quick grid and the home
  sections already were.

- The lyrics screen comes with the blurred artwork behind it, the same as the
  player it opens from, instead of the flat tint. Only for a profile that has
  never said otherwise: anyone who picked a background keeps the one they
  picked, in Settings › Player.

- "Measure performance" comes switched off, and no longer explains itself. It
  is turned on when somebody is being walked through a slowdown, and until then
  it was measuring for a report nobody was going to send. Same rule as above:
  a profile that already has it on keeps it on until it is turned off.

- "Playing from" says the mix once the queue has become one. When an album or a
  playlist runs out, autoplay keeps it going with similar songs, and from the
  moment one of those starts the header was still naming the album: songs that
  are not in it, under a heading that was also a link, so tapping it walked to
  a place that had nothing to do with what was sounding. It now reads "Mix of
  «song»", after the song the mix was grown from, and stops leading anywhere
  until the queue goes back into the album. The queue screen separates the two
  the same way, with the mix under its own heading. Skipping back into the
  album puts the album's name back, and a queue extended with more albums by
  the artist you were listening to keeps naming the artist, because that is
  still where it comes from. Asked for by @ztx-lyghters (#65).

- Settings keep every setting where it is without a connection, greyed out
  instead of taken away. Streaming quality and its codec, everything about
  downloading, autoplay, the devices button, folder browsing, the playlists of
  the quick grid, the chips on Home, "Start mix" and "Rate" in the song menu:
  all of them vanished offline, so looking for one meant walking through every
  screen that could plausibly hold it before working out that it had never been
  there. They now stay in their place, dimmed and not answering, and that is
  all the explaining it takes: a line at the top of each section saying they
  apply once there is a connection said the same thing a second time, so it is
  gone (@ztx-lyghters). The values are still shown, since what they say will
  happen is still what will happen. "Library" goes the same way, dimmed and quiet: everything it holds is
  the server's, and what can be done about downloads with no connection already
  lives in the section above it. Asked for by @jaredm4.
- Server addresses can be reached without a connection, which is the one place
  where being shown is not enough. A wrong address, or a server that moved, is
  exactly what puts the app offline, and Settings › Network was hidden there:
  the way out was to delete the profile and sign in again, or to walk to the
  network the old address works on. It is now a normal screen in offline mode,
  and it works, because checking an address is a ping and that is one of the
  two requests offline mode lets through. Reported by @jaredm4.

## [0.6.2] - 2026-08-04

Offline mode now means it. The rule that the app asks nobody anything without a
connection was repeated at every place that talks to the server, and several of
them had forgotten it: the queue went up every twenty seconds, the addresses
were probed on every network change, the lyrics were looked up, and the covers
of albums you had not downloaded were fetched one by one. On a metered
connection that is somebody's money. The rule now lives underneath, in the one
place that makes requests, where there is nothing left to forget. Browsing
without a connection is only worth as much as the pictures that come with it,
so those covers are now kept on the phone on purpose instead of borrowed from
a cache that throws them out.

The app also stops getting slower the longer you use it. A screen you had left
kept re-rendering behind the one you were on, which is what made the half
second between screens grow as you went, and a tab you had opened once kept
redrawing for the rest of the session.

Jellyfin catches up on three things it could not do: taking songs out of a
playlist, moving around inside a track that is being transcoded, and saying how
far into that track you are on the lock screen.

And what you listen to away from the network reaches the server when it comes
back, carrying the time it happened, so an evening's music lands where it
belongs in the history instead of arriving all at once the minute the phone
finds a signal.

### Added

- When a downloaded song plays from the file is now yours to decide, in
  Settings › Quality & playback. It always played from the file, which is what
  a download is for and what nearly everyone wants, but a library downloaded
  small to save room is a worse copy than the one on the server, and whether
  that matters depends on what the connection costs. So: always, on mobile data
  only, only when the download is the original file rather than a transcode, or
  never. Without a connection the file is used whatever it says, since it is
  the only thing there is. The quality badge under the player follows the same
  answer, so it never claims a smaller copy while playing the good one. Asked
  for by @CraftoHohenvels and @ztx-lyghters.
- A way out of a deep pile of screens. An artist, one of its albums, another
  artist off a track, a genre from there: getting back was four taps, and there
  was no shorter way. Holding the back arrow now drops the whole pile at once,
  and leaves you where you came in: screens opened from the Library end at the
  Library, screens opened from a search end at Search. Not the tab the app
  happens to open on, so nobody lands in a list of albums they never asked for.
  Nothing announces a long press, so for whoever wants the way out in plain
  sight there is "Always show the navigation bar" in Settings › Appearance ›
  Navigation, off by default, which keeps Home, Search and Library at the
  bottom of every screen and clears the stack on the way there too. Raised by
  @ztx-lyghters, and by justtrife in the Discord.
- Shuffle and repeat are still on when you come back. Both were forgotten on a
  cold start, so whoever listens shuffled had to say so again every morning,
  which is not a setting anyone means to give twice. They travel with the queue
  that is already saved for each profile, so they come back with it and with
  the song it was left on. What is not kept is the order the list had before
  being shuffled: it would double what a queue weighs on disk, and turning
  shuffle off after a restart simply keeps the order that is playing instead of
  going back to the album's. Asked for by @ztx-lyghters, on behalf of another
  user.
- What you listen to offline reaches the server anyway. Away from the network
  the play could only be counted on the phone, for its own "Most played", and
  as far as the server was concerned a whole trip's music had never been
  played: nothing in the history, nothing in the counters, nothing scrobbled on
  to Last.fm or ListenBrainz. Each listen now waits in the same outbox that
  already held favourites, ratings and playlist edits, and goes up on
  reconnection carrying the time it happened, so an evening's music lands in
  the right place in the history instead of arriving all at once the minute the
  phone finds a signal. The rule for what counts as a listen has not changed:
  half the song or four minutes, whichever comes first, so skipping through an
  album still inflates nothing. Asked for by @CraftoHohenvels.
- A playlist shows its description, between the name and the line that counts
  the songs and in the same quiet type: what it says about itself belongs with
  the rest of what it says. Whole, however long it runs, because a description
  cut short with the rest hidden behind a tap nothing announces is barely
  better than one not shown at all; whoever prefers the header bare turns it
  off in Settings › Appearance › Song lists. The app could already write that
  field and never showed it. Jellyfin's, which allows markup, arrives as plain
  text. Asked for by @ztx-lyghters.
- Volume normalization has a pre-amp, right under it in Settings › Quality &
  playback and only there while normalization is on. ReplayGain aims at -18
  LUFS and the apps everyone else on the phone uses aim at -14, so turning
  normalization on left the music noticeably quieter than everything around it,
  and the fix was riding the system volume up and down between apps. The slider
  moves the level the whole library normalizes to, from -10 to +10 dB in half
  dB steps, and takes effect on the song already playing; tapping the value
  opens a small pad with arrows that move it a tenth at a time, which is the
  precision a finger on a slider can't reach. A song already close
  to its peak takes less of the boost than asked, because the rest would be
  distortion rather than volume. Asked for by @jaredm4.
- A server address can be edited, in Settings › Network. There was a pencil's
  worth of work missing there: a domain that changes, a server that moves to
  another port, and the only way through it was adding the new address and
  deleting the old one. That worked for every address except the first, which
  could not be deleted at all, and the first is the one an account is most
  likely to have only. It could not be deleted because it was what the profile
  was filed under: its settings, its downloads, its queue and its history all
  hang off that address, so changing it would have hidden the lot. What a
  profile is called is now written down once and kept, whatever happens to the
  addresses afterwards, which is what lets any of them be edited or removed as
  long as one is left. A new address still has to answer with your account
  before it is accepted, same as when adding one. Asked for by @jaredm4.

### Changed

- Counting songs is inflected properly in every language. "{n} songs" was a
  template with the noun written into each translation, so a language whose
  plural is not a simple two-way split could only pick one form and be wrong
  the rest of the time: in Russian a playlist of two read as "2 композиций",
  the form for five and up. It now goes through the same plural forms the rest
  of the app already used, which Russian fills in with three. On a playlist
  card, in the queue's header, under a playlist in search and while a local
  library is being scanned. Reported by @ztx-lyghters.
- "Song information" opens the cover, browses the genre, and lets itself be
  read. The art in its header is the song's own, which on a live album or a
  compilation need not be the album's, and there was no way to see it without
  playing the track: tapping it opens it full screen like every other cover.
  The genre is now the same chips the album header has, so it is somewhere to
  go and not a line of text. And with the list long enough to scroll, pulling
  down to get back to the top was closing the sheet instead: the drag only
  belongs to the sheet at the top of the list now, and the header still closes
  it from anywhere, the way the song menu already worked. Raised by
  @ztx-lyghters.
- Taking a favourite off a song in a list can be undone. The toast that says so
  carries "Undo", and until it goes nothing has been asked of the server, so
  undoing is not a second request but the first one never leaving. In a list
  the heart is small and sits where a finger scrolls, and a tap given by
  accident had to be put right through the song's menu. The swipe gesture goes
  the same way. Elsewhere the heart is on a screen about that one song, artist
  or album, where it is not hit by accident, and it still answers at once, as
  does marking a favourite anywhere. Raised by @ztx-lyghters.
- The app no longer asks for the microphone, the camera or drawing over other
  apps. It never used any of the three: the recording permission came in with
  the audio library, the camera with the image picker (both places that pick an
  image go to the gallery), and the overlay one with the project template,
  where it belongs to React Native's development tools. None of them was a
  hole, since Android asks before granting any of them and the app never asked.
  They were a reason to distrust a music player, which is worse: whoever reads
  the permission list before installing deserves one that only holds what the
  app does. Debug builds keep the overlay so the developer tools still work.

### Fixed

- Offline, an album shows its artist's photo, and its tracks show a cover. The
  covers kept for browsing without a connection were filed under the name each
  thing calls its own picture, and the screens ask for them under other names:
  an album asks for its artist's photo by the artist's id, and a track row asks
  by whatever cover id the server gave that one song, which on some servers is
  a different one per track. Both are answered now, one from the artist's photo
  saved under both its names and the other from the album's cover, which is the
  same picture in all but the rarest case and is one file instead of one per
  song.
- The player leaves no gap under a song that has no lyrics. Room for the
  lyrics card was kept for every song, whether or not there were any to put in
  it, so a song without them sat pushed up with an empty strip below, and
  turning the card off in Settings was the only way to get that space back. It
  is now kept only once there are lyrics in hand: without them, and while they
  are still being looked for, the player looks exactly as it does with the card
  turned off, and the cover uses the room. Lyrics arriving while you are
  looking at the player settle the cover a touch smaller, which is the price of
  not leaving the gap the rest of the time; they are usually found before the
  player is even opened.
- Online lyrics search works again. Every lookup on Android was being turned
  away by LRCLIB with an error, so a song the server had no lyrics for simply
  showed none, whatever the setting said. The app was not saying who it was:
  React Native sends the name of the HTTP library it is built on, and that is
  what was refused. It now introduces itself, which is what their API asks for
  anyway. Nothing about the setting changed; it had never been the setting.
- Lyrics are looked up again when the app has fallen back to offline on its
  own. Making offline mode offline took LRCLIB with it, which is right when
  somebody chose that mode and wrong when the app chose it for them: falling
  back means one server stopped answering, not that the phone lost its
  connection, and the lyrics are somewhere else entirely. Whoever never noticed
  the mode had changed just saw lyrics stop working. An offline you asked for
  still asks nobody anything.
- Tapping a song in the history that is not downloaded, offline, no longer
  leaves the player telling a lie. It could not play, which is right, but the
  queue had already been replaced: the mini player showed that song, and
  pressing play resumed whichever downloaded track had been loaded before it.
  The history now dims what it cannot reach and says so when tapped, like every
  other list, and a queue with nothing playable in it is refused outright
  rather than shown, so whatever was playing keeps playing.
- The history is there offline, and it is the same history. It is written on
  this phone as each song plays and needs nobody to read it back, yet it was
  hidden from Home without a connection, so a screen that worked could not be
  reached. It was also filed by mode rather than by account: everything played
  offline, by any profile, went into one shared list, which is the mixing that
  keeping them apart was for. An account's listening is its own now, connection
  or not. Nothing has been deleted, but plays made offline before this will
  stay where they were, which is the list a local profile shows.
- Search no longer offers what it cannot open offline. "Browse all" laid out
  its genres, or rather the grey shapes of them, and radio stations were
  searched for too: both are the server's to answer, and offline the answer was
  a request that failed, leaving the loading shapes behind. A genre in
  particular has nowhere to go there, since the app keeps no index of them
  without a server. They are simply not offered until there is a connection.
- The covers of what you can browse offline are kept on the phone. They were
  only ever an address on the server, so without a connection they came out of
  the image loader's cache or not at all, and that cache is not the app's: it
  has a size and it throws out the oldest, so on a library of any size the
  shelves were mostly grey squares. Now, while online, whatever is written to
  the offline copy has its cover saved once, small, right next to it. Nothing
  is crawled ahead of time: it follows what you were already looking at, which
  is the same rule the offline copy itself follows, and it goes when that
  profile's data goes. Albums, playlists and artists, which is what the shelves
  are made of.
- Offline mode makes no network requests at all. It was built as a rule
  repeated at every place that asks the server something: each one checked the
  mode and went to the copy on the phone instead. That holds for as long as
  nobody forgets, and several things had: the queue was pushed to the server
  every twenty seconds and every time the app went to the background, the
  server's addresses were probed on every network change and at every cold
  start, lyrics were looked up on LRCLIB, and the covers of albums that were
  not downloaded were fetched one by one, which is what made album art appear
  slowly on a screen that should not have been loading anything. On a metered
  connection that is somebody's money.
  The rule now lives underneath, in the one place that makes requests: with
  offline mode on, a request fails before it reaches the network, and it starts
  that way at launch until the saved mode has been read, so a cold start cannot
  leak either. Forgetting a check somewhere is now a bug that shows itself
  rather than one that quietly uses data. Two things still go out, and both are
  asked for: checking whether the server is back, which is the only way out of
  an automatic offline, and the "test" button in Settings › Network.
  What changes on screen: nothing, in the end. The covers of what you can
  browse offline are now saved on purpose rather than fetched when you look at
  them, so the shelves fill the same way they did (see below).
  Found by @ztx-lyghters with a packet capture, after @aona noticed the album
  art loading.
- A song whose file says nothing about its album no longer files it under
  "Álbum desconocido", in Spanish, whatever language the app is in. The same
  went for an artist. Those two names are how the local library groups what
  arrives untagged, and they doubled as the album's and the artist's id, which
  is why they were never translated: the id is written into the catalog on the
  phone and into the name of every cover saved with it, so changing it would
  have orphaned all of it and forced a rescan. They stay as they are underneath
  and are translated on the way to the screen, so a library already scanned
  reads correctly without being scanned again. Downloads on a server account
  did the same thing and are fixed with it.
- The list of devices to play to no longer offers things that cannot play. A
  search for speakers has to go out to the whole network, so everything on it
  answers, and almost nothing in a house plays music: the router is the usual
  one, since it speaks UPnP to open ports, and for anyone without a DLNA
  speaker it was the only thing on the list. A device is now asked whether it
  can be played to at all, and the ones that answer that they cannot are left
  out. The ones that answer nothing still show: not having been able to ask is
  not a no, and a speaker missing from the list is worse than a router on it.
- Resonus no longer asks the system for the audio the way an interruption
  asks for it. Playing anything requested the audio "for a moment", which is
  what a navigation prompt, a notification or a call asks for, and the request
  never said what it was for. A car reads exactly that to decide which of its
  channels an app belongs on, and the one for something short and unnamed is
  the one calls come out of: the volume shows a phone rather than a speaker,
  and the music arrives with the bandwidth of a phone call. It now asks the way
  a music player does, for as long as the music lasts, and says it is music.
  This is the second half of what 0.6.1 fixed on the same report: the first
  stopped the app from taking over the phone's call route, and the symptom
  stayed. What it changes elsewhere: an app paused to let Resonus play is no
  longer told to expect the audio back, so it will not resume on its own when
  the music stops, which is how every other music player behaves. Reported by
  @CraftoHohenvels and @Anakin-bb8, still to be confirmed from a car.
- Going back a song no longer turns shuffle off by itself. The back button
  restores where you were along with everything that came with it, shuffle
  included, so pressing it after shuffling a list undid the shuffle: the list
  had been reordered underneath, and the position it went back to belonged to
  the order from before. Changing the shuffle of a list now forgets those
  positions, for the same reason starting the list again does.
- Shuffling a list twice left the first shuffle within reach of the back
  button. Pressing "Shuffle play" again builds a new queue, but the old one
  stayed in the history that ⏮️ walks, so going back from the first song
  dropped you into the queue that had just been thrown away, and from there
  the songs that followed were the old ones, not the ones the queue on screen
  showed. Starting a list that is already playing now forgets where you were
  in it, since there is nowhere to go back to: it is the same list. Going back
  to a different album or playlist, the one you were listening to before this
  one, works as it did. Reported by @CraftoHohenvels, and seen on artists too
  by @ztx-lyghters.
- An album's genre chips show every genre it is tagged with. The row stopped at
  six, which is a number a well tagged record reaches without trying, and the
  rest were simply not there: nothing said so, so the album looked like it
  carried fewer tags than it does. There is still a ceiling, at fifty, but only
  so a library with a tag per track can't fill the header with a thousand
  chips; the row scrolls sideways, so however many there are nothing below it
  moves. Two genres on the same track were also being read as one, since only
  the first was taken from each: on Jellyfin the others were dropped as the
  song was read, which left "Song information" showing a single tag as well.
  Reported by @ztx-lyghters.
- The player screen could be scrolled a little with the lyrics card turned off,
  which made it look like something was hanging past the bottom edge. Nothing
  was: the card is the one thing that reaches below the first page, and the
  room left for it at the bottom of the scroll was being kept whether or not
  there was a card to put there. Without one the player is exactly one screen
  tall again and stays put. Reported by @ztx-lyghters.
- "Nothing here is downloaded" greeted a cold start in offline mode. The saved
  queue is restored as soon as the session is, which is before the list of
  downloaded files has been read out of the database, so every song in it
  looked like it was only on the server. The queue now waits for that list,
  and the message is only given when playing was actually asked for, not when
  the app is putting itself back together on its own.
- Songs can be taken out of a playlist on Jellyfin. The track went, the way it
  should, and came back a moment later with "Couldn't complete the action",
  and the server had no record of having been asked anything. It hadn't been:
  removing a song is done by handing the server the playlist as it should end
  up, which is one call in Subsonic and no call at all in Jellyfin, and that
  one request was going out in Subsonic's words to a server that doesn't speak
  them. Jellyfin gets it in three steps instead, over the entries a playlist is
  actually made of. Which also means playlists can be reordered there now, by
  holding a track and dragging it, an option that was hidden on Jellyfin for
  the same reason. Reported by @jaredm4.
- The notification and the lock screen show how far into the song you are while
  streaming transcoded. They showed the times and the progress bar for a file
  arriving untouched and nothing at all for one being converted on the way,
  which is the same song and looks like the controls half broke. A server
  transcoding on the fly can't say how long the result will be before making
  it, so it sends no length, and the player had no duration to hand over. It
  does not need to guess: the app knows the song's length from the library, and
  now passes it along with the title and the cover. Only as a fallback, so a
  file, or anything that does know its own length, still answers for itself.
  Reported by @jaredm4.
- Moving around inside a track works on Jellyfin while streaming transcoded.
  Touching the bar started the song over, every time. A transcode is made as it
  is sent, so there is nothing behind or ahead to jump to: the only way through
  it is asking the server to start the stream at that second instead, which the
  app already did for the Subsonic servers that offer it. Jellyfin has it in
  its streaming endpoint and was never asked, so it kept sending the track from
  the top. Downloads and untranscoded streams were never affected, since those
  can be moved around like any file. Reported by @jaredm4.
- The cover in the player belongs to the song that is playing, however fast you
  swipe. Two or three quick swipes and it settled one track ahead: the cover of
  the song after, with the right title under it and the right music playing,
  and it stayed that way for every song after that. The strip of covers and the
  queue count the same swipes, but not at the same instant: a swipe reaches the
  screen one render later, and one that landed before that render measured its
  travel from a count one behind, leaving the strip parked a cover away from
  where the music was. It now counts them where they happen. A swipe toward an
  end of the queue that has nowhere to go gives the travel back instead of
  counting it. Reported by @ztx-lyghters.
- The app no longer gets slower for the rest of the session the first time you
  open Search. Tabs are never closed once visited, only hidden, so they are
  meant to stop working while you are elsewhere, and they were not: asking for
  a fade between tabs turned that off, quietly and completely, the day it was
  added. Every visited tab kept redrawing on every screen change, and Search
  lays out the whole genre list of the library at once, with nothing recycling
  it, so from the first visit on it was rebuilt on every navigation, on a
  library with hundreds of genres. Both halves are fixed: a tab you are not on
  stops, and the genre grid is built once. The tabs no longer crossfade, which
  is what the fade cost. Reported by @ztx-lyghters.

## [0.6.1] - 2026-08-01

Songs get a place of their own: a chip on Home opens the library's songs with a
search box, rows or covers, and the same orders browsing albums and artists
already had. Which of those the server can actually do varies, so on Navidrome
they are asked of its own API, which is the only way an alphabetical listing of
a large library is possible at all.

Sharing now says when a link should stop working, and on Navidrome whether it
can be downloaded from and not only listened to.

And Resonus no longer takes over the phone's call audio while it plays, which is
what could make music arrive in the car sounding like a phone call.

### Added

- A "Songs" chip on Home, next to Albums and Artists, opening the library's
  songs the way those two open theirs: a search box, rows or a grid of covers,
  the same orders on pills, and infinite scroll. Holding one starts selecting,
  so a playlist can be built out of loose tracks in one go. Sorting them is the
  server's business and not every one can: Navidrome is asked through its own
  API, which sorts and pages a six-figure library a page at a time, and Jellyfin
  and a local library sort by everything too. A plain Subsonic server cannot
  sort songs at all, so there recent, recently added and most played are arrived
  at through the albums it does sort, A-Z is not offered, and its own order
  stands in that place. The chip can be hidden or moved like every other one, in
  Settings › Appearance › Explore chips. Asked for by @rdnamil.
- Sharing asks how long the link should last: never, an hour, a day, a week, a
  month, or a date off the calendar. Choosing is what creates it, so it is one
  tap more than before, and the last answer comes back marked for the next time.
  On Navidrome the sheet also decides whether the link can be downloaded from,
  not only listened to, which is not something the Subsonic API can say and has
  to be asked of Navidrome itself. Asked for by @ztx-lyghters.
- Internet radio shows what is playing. Stations that announce their tracks put
  the song and the artist where the station's name used to sit, on the player,
  the mini player, the notification, the lock screen and in the car, and they
  update as the broadcast moves on. One that announces nothing looks exactly as
  it did. Asked for by @ztx-lyghters.
- Tapping an artist's photo opens it full screen, uncropped, the way album
  covers already did. The header has to crop photos to fill its space, and
  faces were ending up outside it. Asked for by @ztx-lyghters.
- 256 kbps, for streaming and for downloads, asked for by @CraftoHohenvels.
- The streaming codec can be chosen per network, as the quality already was:
  the file as it is over Wi-Fi, so the server is not re-encoding what was
  already fine, and something smaller on mobile data. Asked for by
  @ztx-lyghters.

- "Song information" in a song's ⋯ menu: what the server knows about the track,
  and where there is no server, what its own tags say. Album, year, track,
  genre, format and sample rate, size on disk, plays, rating, and the comment
  tag, which people use for notes about a recording and which nothing in the
  app showed until now. The format reads exactly as it does on the player,
  arrow and all, so a downloaded transcode says the same thing in both places.
  Only the fields the song actually has are listed. It can be hidden like every
  other action, in Settings › Appearance › Song menu. Asked for by
  @ztx-lyghters.

### Changed

- An artist's album rows hold fifty covers instead of ten, and "Appears on"
  got the same "Show all" the discography already had, with its own screen for
  the whole list. Asked for by @ztx-lyghters.
- The play button on an artist always has something to play. With no popular
  tracks it plays the discography from the earliest album on, which is what a
  server that keeps no play counts leaves you with, and until now the button
  did nothing at all. Raised by @ztx-lyghters.
- When an artist's popular tracks run out the queue carries on with the rest of
  that artist, album by album, and only then does the mix of other people get
  its turn.
- The equalizer no longer touches the audio while it is switched off. Its
  effect used to be attached to every song either way, which keeps Android from
  handing playback to the low power path: battery and heat spent on something
  most people never turn on.
- Home says when you are offline, with the same quiet cloud the other tabs
  already had in their headers. It was the one screen that showed you a shorter
  library without a word about why.
- "Library copy", in Settings › Downloads, is now "Library metadata copy". It
  sits under the bar that counts your downloads and read as a second copy of
  the music, which it is not.
- The transcode codec is greyed out while its quality is "Original". At that
  quality the file arrives exactly as it is on the server, so the codec had
  nothing to do and was ignored without saying so: picking Opus there looked
  like a setting that did nothing. It now says as much instead of showing a
  codec that is not being used, and stays in view so it can still be found. In
  Settings › Downloads the two have also swapped places, quality first and the
  codec under it, which is the order they already had for streaming. Raised by
  @ztx-lyghters and @CraftoHohenvels.
- Home's greeting changes over at the hours the language actually uses. The four
  greetings were translated but the clock behind them was Spanish for everybody,
  so English, German, Italian and Russian were told good afternoon at eight in
  the evening. They now switch at midday and at six, which is what those
  languages are closer to, and Spanish and Catalan keep the later hours they had.
  The greeting also changes while the screen is open, which it did not before.
  Translators can ask for their own hours, see TRANSLATING.md.
- "Original" streaming quality says what it actually does. It read as "uses the
  highest quality", which describes a result rather than what happens, and left
  room to read it as the highest the codec can manage or the highest available
  for that track. What it means is that the file arrives exactly as it sits on
  the server, untouched, which is the whole reason to pick it. The warning that
  the other options can cost quality you hear was missing too. Raised by
  @ztx-lyghters.
- Two strings that could not be translated properly. The row that creates a
  local profile said "Local", an adjective with no noun behind it, and now says
  "Local profile", the name that profile carries on every other screen; and
  "Original", the quality option, was written into the app in English and never
  reached the translators. Reported by @ztx-lyghters.

### Fixed

- Resonus no longer claims the phone's call audio for itself. Starting
  playback took over the route calls use, which the app has no reason to touch,
  and it kept it for as long as it was open. On a car that is the kind of thing
  that gets music treated as a phone call, which is what it sounds like: narrow,
  crackly, nothing like the file. It also now says what it plays is music, which
  is what lets Android send it down the low power path instead of mixing it on
  the CPU. Raised by @CraftoHohenvels and @Anakin-bb8.
- Cover art reached the notification and nothing else. What a car shows over
  Bluetooth, what Android Auto shows and what the system's own controls show
  all come from the track, and nothing was ever attached to it, so all they had
  were the tags inside the file: an original FLAC carried its cover, a
  transcode arrived stripped of it, and downloads in Opus had none at all. The
  cover also comes off the disk when the album is downloaded, so it is there
  with no connection. Reported by @jaredm4 and @ztx-lyghters.
- Casting to a UPnP or DLNA speaker answered "this song can't be cast", every
  song and every device. Tracks went out announced as video, which a TV plays
  anyway and a speaker refuses. They now say what they are, and the cover, the
  artist and the album go with them. Reported by @kebbob.
- On Jellyfin every transcode came out as mp3 whatever the codec setting said,
  and downloads were saved under the name of the codec that had been asked for.
  Files downloaded before this are still mp3 and have to be downloaded again.
  Reported by @jaredm4.
- The blurred background went black for an instant between one song and the
  next, on the player and on the lyrics screen. The previous cover now stays up
  until the next one is ready and they dissolve into each other.
- The lyrics card on the player stopped short of the bottom of the screen,
  leaving a strip of background under it. It now runs to the edge, and the
  controls above it keep their distance from the navigation bar on their own.
  Found and fixed by @Anakin-bb8.
- The heart said nothing. Marking a favourite from the swipe or from a menu
  confirmed it, but tapping the heart itself, on the player, the mini player,
  a song row or an artist, did not, and if the server refused the heart quietly
  went back to how it was, which looked like a mistyped tap.

## [0.6.0] - 2026-07-30

Your downloads and your offline library move out of the JSON files they lived
in and into a database. Nothing is lost in the move: the old files are kept,
renamed, and only after everything they held has arrived.

Note that this is a one way trip. Going back to 0.5.6 or earlier after
installing this will show no downloads at all, because the files those versions
read have been renamed.

### Added

- Gapless playback, for real this time and with no setting to find: an album
  that was recorded to run without pauses now plays that way. Thanks to
  @haccersmakker, who tracked down the gap that was left on the first change of
  track.
- Favourited albums and artists open offline even if you have never downloaded
  a song from them.
- Radio stations can be pinned to the top like playlists and albums, and once
  there are enough of them the screen offers a search box.
- German and Italian are complete, thanks to @Psychotoxical and @Anakin-bb8.

### Changed

- The offline copy of your library no longer has size limits. Playlists over
  five hundred songs used to be dropped, as were albums you had downloaded in
  full; both are kept now. Saving one playlist writes one playlist instead of
  rewriting the whole copy.
- Only the profile you are using has its downloads read when the app starts,
  instead of every profile you have ever added.
- Up to twenty five things can be pinned, rather than four.
- Choosing an order in the sort menu closes it, the way the one in the Library
  already did.

### Fixed

- Original quality played lossless files at double speed and an octave up,
  with heavy clipping, on phones whose decoder answers a request for 32-bit
  audio without saying that it did. It reached the 0.6.0 pre-release only, and
  transcoding is no longer needed to get around it.
- Downloading a library asked the server twice for the lyrics of every song
  that has none, doubling the requests queued in front of the screens.
- Switching profiles could leave the offline library unreadable, showing
  playlists with names like `dl_obp32J49` and no favourites.
- Deleting a discography could fail on a large one.
- Counted playlists read "1 playlists" in every language.
- With Android's "Bold text" turned on, the last letter of a word was dropped
  all over the app: "MP3" read "MP", "2.6 GB" read "2.6". The app no longer
  takes that setting, so it renders at its usual weight instead.
- Removing a profile now asks first, and takes its downloads and its offline
  copy of the library with it instead of leaving them on disk for good.
- Random songs and the mix took the same amount from every library whatever
  its size, and the mix could still draw on a library you had disabled.

## [0.5.6] - 2026-07-27

Mostly a performance release. On large libraries the app was doing a great deal
of work nobody asked for, and the bigger the library the worse it got.

### Added

- Delete the downloads of your favourites from their ⋯ menu, as albums,
  playlists and discographies already allowed.
- Settings › Downloads shows what the offline copy of your library takes up,
  next to what the downloads themselves take.

### Changed

- The ⋯ menus of playlists, favourites, the queue and artists, and the sort
  sheet, now slide in and out and close by dragging them down, with the same
  grabber the song menu has.
- The song ⋯ menu opens showing one more action before you have to scroll.
- The offline copy of your library no longer grows without end. It keeps your
  playlists, your favourites and whatever has downloads, and it is tidied up
  when the app starts.

### Fixed

- Downloading no longer drags the whole app down. Each finished song was
  recounting every album by walking every song, which on a large library is
  millions of comparisons per song, on the thread that answers your taps.
- Deleting downloads did the same twice over, and asked every screen in the app
  to reload before it had actually deleted anything.
- The app no longer downloads the full contents of every playlist you own on
  every start. It was tens of MB before the first screen had finished loading.
- Android Auto's browse list is no longer built within a second of opening the
  app, fetching the songs of every album on your shelves and every favourite,
  whether or not a car is ever plugged in.
- Storage used no longer measures every downloaded file one at a time, which
  froze the app while it counted and did not even stop when you left the screen.
- The Library no longer sorts its lists again on every redraw and every letter
  typed into its search box.
- Cover art is kept in memory once decoded, instead of being decoded again
  every time it scrolls back into view.
- The full screen player no longer repaints itself twice a second while music
  is playing.
- With more than one library active, shelves ask for what they show instead of
  five times as much, and "Random albums" now takes each library's size into
  account rather than giving them equal turns.
- A large install could open showing placeholders that never resolved, and the
  switch to offline mode could be missing from Settings while the downloads
  were still being read.
- Lyrics are asked for once per song rather than twice, and the next song's are
  no longer requested at the exact moment a track changes.

## [0.5.5] - 2026-07-26

### Added

- Share a song, album or playlist as a link, on servers that allow it.
- Genre screens now have a Songs tab next to the albums, with play and shuffle
  for the whole genre, a grid/list switch and multi-select on the songs.
- Genre chips on album screens; tap one to browse it. Off by default, under
  Appearance.
- Search finds radio stations too.
- Search your playlists, albums and artists from the Library.
- Radio stations show the image the server holds for them, and changing it in
  Resonus uploads it, so every client and Navidrome itself show the same one.
- Delete the downloads of an album, a playlist or a whole discography from its
  ⋯ menu — offline included, and half-downloaded ones too.
- A warning when Android's battery optimization is restricting the app, which
  is what usually stops playback in the background. Switch under Playback.
- Grid or list in an artist's full discography, remembered.
- "Play discography" in chronological order, from the artist's ⋯ menu.
- "Good night" as a greeting in the small hours.
- The Russian translation is complete again.

### Changed

- The song ⋯ menu opens showing the actions most used and grows when pulled up;
  its grabber closes it from anywhere in the list.
- Search asks what you want to listen to instead of listing what it can find —
  it finds more than it used to say.
- The search bar in Browse albums and artists is simply there, instead of
  appearing when you pull the grid down.
- Removing a download, turning on auto-download and clearing an album's
  downloads ask first. Downloading from a ⋯ menu now says how much space it
  will take, as the album's own screen already did.
- The player's background is blurred cover art by default.
- Shuffle sits next to play on the artist screen and lights up when it's on.
- «Rate» shows in the song menu by default.
- "Help translate" opens the translation guide.

### Fixed

- Downloading no longer rewrites the entire download catalog for every single
  song, which froze the app on large libraries and left deletions looking like
  they had done nothing until a restart.
- With more than one library active, album lists no longer read every library
  whole just to show twenty albums.
- Finishing a download no longer sends the app off to re-fetch everything from
  the server.
- Cover art is no longer downloaded twice, once to show and once for the colour.
- A mix stays anchored to the song it started from instead of drifting further
  from it with every batch.
- Mixes range across artists instead of turning into one artist's discography.
- A mix that finds nothing says so instead of announcing it started.
- Home shelves order across libraries instead of taking turns, so a small
  library no longer crowds out a big one.
- The saved library filter no longer arrives too late to be applied, which
  showed libraries you had disabled for the rest of the session.
- "Recently played" no longer pads itself with albums you have never played.
- Offline search ranks by what actually matched: an artist by name comes before
  one that merely has a song with that word in the title.
- One search history per account instead of one per mode, so the same artist no
  longer shows up twice with only one of them opening.
- Album, artist and playlist screens keep a way back while they load or fail.
- Playback survives the screen turning off.
- Seeking works on streams the server transcodes on its own.
- A profile's settings, pins and downloads are no longer wiped by another
  profile's.
- Multi-disc albums keep their order and disc subtitles offline.
- The cover swipe no longer wraps past the ends of the queue.
- The cover and controls no longer jump when the player opens.
- The progress bar recovers after a track changes with the app in the
  background.
- Casting a lossless track to a speaker that only takes MP3 — Sonos among
  them — no longer fails outright, and a speaker that waits to be told to
  play is now told, instead of sitting silent while the app showed it
  playing.
- The same speaker no longer appears twice in the cast list.

## [0.5.4] - 2026-07-24

### Added

- The Russian translation is now complete.

### Changed

- Resonus is now released under the GPL-3.0-or-later license, so anything built
  on it stays free under the same terms.

### Fixed

- A long value on the right of a settings row squeezed the label until it
  wrapped one letter per line. Most visible in Russian, where the strings run
  longest.

## [0.5.3] - 2026-07-24

### Added

- Blurred cover art as a background for the player and the lyrics screen.
- Show non-square artwork whole instead of cropped to a square.
- Swap the player's favourite and ⋯ buttons, putting the menu within reach.
- Album and year on their own line in the player.
- Refresh a playlist from its ⋯ menu, so smart playlists pick again.
- Close a song's ⋯ menu by swiping it down.
- A ⋯ menu on Favourites, with the same actions as a playlist's.
- Italian translation, and fixes to the Russian one.

### Changed

- Player, Quality & playback and Appearance settings regrouped by what they
  affect.
- The artist's shuffle now covers the whole discography, not just top tracks.
- Dragging the player down reveals the screen behind it.
- Library chips scroll when they don't fit.

### Fixed

- "Appears on" was empty on servers that list collaborations in the discography.
- Playlist covers were replaced by a track's album art offline.
- Starting a mix from the current song restarted it.
- The "playing from" header vanished once Android killed the app.
- Queue covers blinked on every track change.
- Headphone next/previous buttons now skip through the queue.
- Casting finds devices more reliably, and fixes the volume overlay and
  skipping from a Bluetooth device.
- Various smaller fixes and polish throughout.

## [0.5.2] - 2026-07-22

### Added

- Russian translation.

### Fixed

- Big performance fix: opening an album, artist or playlist no longer freezes
  the app while it saves a copy of your library for offline. This was the main
  reason the app felt laggy or "stuck" on large libraries, and it got worse the
  more you browsed — those writes are now batched instead of happening on every
  screen. Going offline is much faster too.
- Switching between online and offline no longer wipes the whole cache, so
  screens you've already opened come back instantly.
- The mini player and song lists re-render far less while music is playing,
  cutting jank when the track changes while you're looking at a list.

## [0.5.1] - 2026-07-22

### Added

- Add a whole album, artist, playlist or the current queue to a playlist, from
  its ⋯ menu.
- Auto-download playlists: mark a playlist and the songs you add to it download
  automatically.
- Choose the streaming and download codec separately — Opus, AAC, MP3 or the
  server default — with a new 160 kbps option.
- Optional album and release year line under the title on the player (off by
  default).
- Multi-disc albums now show disc separators with their titles.
- Optional plain-text password authentication, for Subsonic servers that don't
  support token auth.
- Option to hide unavailable (not downloaded) songs in offline mode.

### Changed

- UPnP/DLNA casting now advances the queue, shows lock-screen controls and
  responds to the volume keys.
- All server playlists are cached for offline, not just the downloaded ones.
- Swapped the positions of the star rating and the audio-quality label on the
  player.
- The offline cloud icon was removed from the Home header.
- Contributing a translation is now much easier: languages live in a single
  place, with a contributor guide and a status helper for translators.

### Fixed

- Seeking a transcoded stream no longer restarts the track when you seek right
  after it loads, and it recovers safely if the server support check hiccups.
- The mini player's swipe direction now matches the full player: swipe left for
  the next track, right for the previous.
- The "Show rating" toggle now appears in the player settings in offline mode,
  where ratings already work.
- Favorited albums now appear in offline mode even when none of their songs are
  downloaded.
- Slow, laggy scrolling in long playlists.
- The mini player no longer covers the last row in tab lists.
- Track preloading now warms the original source instead of the transcode.

## [0.5.0] - 2026-07-20

### Added

- Offline mode now mirrors your whole server library, not just downloads:
  favorites, playlists, starred albums and artists all appear. Songs you haven't
  downloaded show greyed out, with their cover, and can still be selected in
  multi-select, so you see everything and play what's on the device.
- Offline edits sync back when you reconnect: favorites, star ratings and
  playlist changes (add, remove, reorder, create, delete, rename) you make
  offline are pushed to the server the next time it is reachable.
- Radio stations can be managed from the app — add, edit and delete — with a
  radio-aware player and custom station artwork stored on the device.
- Quick grid customization: choose its sources (favorites, albums, playlists),
  its size (4, 6 or 8 cards), and turn it off, all from its own settings.
- Choose which tab the app opens on (Home, Search or Library), returning there
  when you reopen the app after a few minutes away.
- Playlists can now appear as a Home section (off by default).
- Star ratings in song lists, with an optional Rate action in a song's ⋯ menu to
  rate without opening the player.
- Subsonic Jukebox mode, to play through the server's own audio output.
- Previous-button behavior setting.
- "Recently added" sort when browsing Albums and Artists.
- "Downloaded" sort that groups downloaded songs together in playlists and
  favorites.
- Optional Favorites explore chip, and a hidden-by-default "Recently played"
  chip on Home.
- Server accounts now go offline automatically and seamlessly when the server
  can't be reached, including falling back to offline when a saved profile is
  unreachable at login; the auto-switch has a toggle.

### Changed

- Downloads and settings are now per account/profile, and offline behavior is
  sturdier.
- The offline indicator is a single subtle crossed-cloud icon next to the
  greeting; the offline toast just says "Offline"; and the switch-to-offline and
  sign-out pills are lighter.
- Discover shows first among the default Home sections.
- The Recent chip on Albums sorts by recently played and refreshes when you
  enter the screen.
- The repeat button now cycles off → repeat one → repeat all, so the first tap
  repeats the current song.
- Switching server address refreshes the library and hands off the currently
  playing track seamlessly.
- Delete is separated from the other playlist-menu actions by a divider.
- The Downloads settings section is hidden in the local profile.

### Fixed

- Playlist song removal is hardened against index drift, so the right song is
  removed even if you go offline mid-edit.
- Random artists and Discover reshuffle on pull-to-refresh on Home.
- The password field no longer forces an uppercase keyboard, and revealing
  search gives a single haptic.

## [0.4.0] - 2026-07-17

### Added

- Built-in equalizer, with the device's presets, a slider per band and a reset
  to flat (Quality & playback).
- Home sections can now be shown, hidden and reordered, with three new rows off
  by default: Discover (albums you played a while ago but not lately), Random
  albums and Random artists.
- The Home explore chips can now be shown, hidden and reordered too, and a new
  Shuffle chip plays random songs from your library straight away.
- Start mix on a song's ⋯ menu: the song plays at once and the queue keeps
  filling with music like it. The queue header shows a button to stop it.
- Shuffle button on the genre screen, to play a genre at random.
- Choose which actions appear in a song's ⋯ menu (Appearance).
- Configurable swipe actions on song rows, in both directions: add to queue,
  play next, add to favorites or open the options menu.
- Network settings (experimental): several server addresses with automatic
  switching.
- Choose what tapping the player cover does, including showing the lyrics in
  place.
- Lyrics entry in the player's ⋯ menu.
- Bulk downloads can be stopped, keeping whatever already finished, and they
  start downloading almost immediately instead of after a long scan.
- Browsing artists now shows a grid of artist cards with sorting by name,
  recently played, most played or random.
- Grid or list when browsing albums and artists, from a button in the header.
  Each screen remembers its own.
- Search when browsing albums: pull down at the top of the list to find an album
  anywhere in your library.
- Download an artist's whole discography from their page, with progress and the
  option to stop it.
- The Home greeting can be hidden, or replaced with your own text, under
  Appearance › Home › Greeting.
- More accent colors in the palette.
- Pressing the Search tab when you are already on Search brings up the keyboard,
  so you can start typing without reaching for the box. Arriving from another
  tab it takes two presses, which leaves Browse all in peace on the first one.
- Preload upcoming tracks (Quality & playback, off by default): the next few
  tracks are requested ahead of time so they start instantly, even when you skip
  several ahead. Aimed at proxy servers like Octo-Fiesta, or slow sources that
  only fetch a track the first time you play it.

### Changed

- The "Show explore chips" switch is replaced by a switch per chip. If you had
  the chips hidden they stay hidden after updating.
- Online lyrics lookup is now on by default.
- The cover-tap and skip-button settings are now dropdowns instead of long
  lists of options.
- Only favorited albums can be pinned.
- Recently played now appears on Home in local mode, and an artist's Popular
  songs are ordered by your play count there.
- Settings screens no longer offer switches for things that don't exist in
  local mode.
- The artist's Popular songs line up with the rest of the lists instead of
  running edge to edge.
- The filter when browsing artists now stays out of the way until you pull down
  at the top of the list, the same gesture playlists and favorites use.
- The sleep timer fades the music out over its last seconds instead of cutting
  it dead.
- Download confirmations now estimate how much space they need, and say so when
  the device may not have enough.
- The sleep timer says how long is left rather than the length you picked, and
  starts counting down from the first second.
- Scanning your device or folder for music is faster: it no longer reads the
  embedded cover of every single song only to keep one per album.
- The local scan's progress bar moves steadily instead of in jumps, counts
  files while it is still finding them, and stays up until the covers are ready
  rather than leaving you on a full bar with nothing happening.
- Browsing albums and browsing artists now offer the same sort chips in the
  same order, and both open on Recent. Sorting albums by artist is gone; browse
  by artist from Artists instead.

### Fixed

- The accent color now repaints Settings immediately instead of waiting for you
  to leave and come back, and the toast's Undo, the error screen's Retry button
  and the login button no longer stay stuck on the default green.
- Settings dropdowns now open flush against their row instead of floating above
  it, and scroll when there isn't room.
- The artist Shuffle button now really shuffles instead of starting with the
  artist's top track every time.
- A mix no longer runs out quietly: it falls back to the artist's tracks and
  then to the genre, and it survives closing the app.
- Clearing the queue now stops a running mix instead of leaving it on but
  unable to grow.
- The artists grid in random order no longer reshuffles itself while music
  plays.
- The favorite heart no longer sticks on album rows after unfavoriting.
- Downloaded cover art now shows offline in server mode.
- Long-pressing a song to enter multi-select now keeps that song selected.
- Bigger tap target on the song row's ⋯ button.
- German and Catalan translations for the newest screens.
- The Autoplay setting no longer claims something a mix contradicts.
- Home and the other screens show a local scan's new music and covers as soon
  as it finishes, instead of waiting for you to pull down and refresh.
- A failed download is no longer saved as if it were the song. Servers report
  some failures with a success code, so the error text was being written to
  disk as the track — and as the album art — marked as downloaded and never
  retried. You would only have found out with no signal, which is when it
  matters most.
- Removing the last downloaded song of an album now leaves that album's screen
  instead of stranding you on an empty page with an internal id for a title.
- Crossfade no longer goes silent in the background. The incoming track's volume
  ramp ran on a timer that Android freezes while the app is backgrounded, so the
  next song came up muted until you reopened the app; it now keeps fading
  correctly with the screen off.
- Playback now pauses when you unplug headphones or a Bluetooth device
  disconnects, instead of suddenly blaring out of the speaker. It used to pause
  only sometimes, on some Bluetooth disconnects, and never on a wired unplug.

## [0.3.1] - 2026-07-12

### Added

- Separate streaming quality for Wi-Fi and mobile data, with new 96 and 64 kbps
  options for tighter data caps.
- Skip back/forward buttons in the player, with a choice of 5, 10 or 30 seconds
  (off by default).
- Press and hold the play button to stop and clear the current playback.
- Setting to show or hide the explore chips on Home.

### Changed

- Reorganized Settings into clearer sections across Player, Quality & playback,
  Downloads, Library and Appearance, with Font moved to its own screen.
- The add-to-playlist sheet is now taller so long playlist lists aren't cramped.

### Fixed

- Downloaded songs now play from disk in server mode, so downloads work
  offline.
- Sorting a playlist by album now respects disc numbers on multi-disc albums
  instead of interleaving tracks.
- The colored-lyrics setting is now honored by the lyrics card in the player,
  not just the full-screen lyrics.
- The player rating row no longer pushes content off screen when every element
  is enabled.
- The keyboard no longer covers the search bar on the add-to-favorites screen.
- Centered the sort chip labels on the Albums screen.

[0.5.2]: https://github.com/juananzzz/resonus/releases/tag/v0.5.2

[0.5.1]: https://github.com/juananzzz/resonus/releases/tag/v0.5.1

[0.5.0]: https://github.com/juananzzz/resonus/releases/tag/v0.5.0

[0.4.0]: https://github.com/juananzzz/resonus/releases/tag/v0.4.0

[0.3.1]: https://github.com/juananzzz/resonus/releases/tag/v0.3.1

## [0.3.0] - 2026-07-11

### Added

- Reorder playlists by dragging, with per-list sort options (Custom / Recent)
  that are remembered.
- Haptic feedback on key actions (off by default, under Appearance).
- App font picker with six fonts, including Typewriter and Casual.
- Folder browsing for Subsonic servers (optional, in Settings).
- Search inside playlists and favorites by pulling down at the top of the list.
- Add-to-favorites screen to star your most played, recent or suggested songs
  in batch.
- Multi-select in playlists, favorites and albums, with undo for destructive
  actions.
- An "Appears on" section on the artist screen.
- ReplayGain volume normalization.
- Change playlist covers from the fullscreen viewer, marquee titles in the mini
  player, queue whole albums or playlists from their menu, a keep-screen-on
  option, a download-over-Wi-Fi-only setting, and more visibility toggles in
  Settings.
- Catalan translation.

### Changed

- Playlists default to Custom sort, like Spotify.
- Song duration is hidden in lists by default.

### Fixed

- Tapping a lyrics line to seek now responds reliably, and the auto-scroll
  animates smoothly on phones with reduced system animations.
- Seeking in transcoded streams.
- The audio quality badge reflects the transcoded stream instead of the source
  file.
- The mini player's dynamic color now matches the player screen.
- Honest scrobbling: correct now-playing updates and Last.fm threshold.

[0.3.0]: https://github.com/juananzzz/resonus/releases/tag/v0.3.0

## [0.2.2] - 2026-07-07

### Added

- Per-library visibility toggles for multi-library servers: pick which
  Navidrome libraries appear across the app (Home, Library, Search, Favorites).
- 1–5 star rating bar in the player (opt-in; off by default).
- Grid view mode for the Library.
- New Theme settings section with an accent color picker.
- German translation.
- Loading skeletons on the Genres screen and the browse and home album/artist
  lists.

### Changed

- The audio quality label is now a player-only toggle instead of appearing on
  every song row.
- Audio fades in and out when you pause or resume inside the app.
- More breathing room between the settings section rows.

### Fixed

- Shuffle play could show a different track than the one actually playing, and
  the shuffle button stayed lit on unrelated albums and playlists.
- The About screen no longer labels the version as beta.

### Removed

- Chromecast support, removing the last proprietary dependency (a step toward
  F-Droid). Casting to UPnP/DLNA devices is unaffected.

[0.2.2]: https://github.com/juananzzz/resonus/releases/tag/v0.2.2

## [0.2.1] - 2026-07-06

### Added

- Tap the cover art in the player to open the full-screen lyrics.
- Artist picker for songs and albums with more than one artist.
- Loading skeleton for the genre cards in Search.

### Changed

- Reworked the mini player gestures: swipe down to dismiss, swipe sideways to
  skip tracks.
- Split the queue into clear sections (now playing, next in queue, next from
  the source).
- Polished the lyrics screen with Apple Music-style line focus and previous /
  next controls.
- Full-screen lyrics now start centered instead of pinned to the top.
- Opening the lyrics now jumps straight to the current line instead of doing a
  fast scroll from the top.
- Softened the cover-derived background color so text and controls stay legible
  on any artwork.

[0.2.1]: https://github.com/juananzzz/resonus/releases/tag/v0.2.1
