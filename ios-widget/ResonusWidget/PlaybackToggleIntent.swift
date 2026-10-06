import AppIntents
import BackgroundTasks
import Foundation

/// The widget's play/pause button: one press, the player toggles, and the
/// app never comes up. `openAppWhenRun` false is the point of the whole
/// file - with it the system runs the intent on its own, the app is neither
/// foregrounded nor shown, and the press still reaches JavaScript: it is
/// written into the shared group as a timestamp, and posted as a
/// notification for the case that this all runs in the app's own process.
///
/// The deep link this replaces is what used to yank the app onto the now
/// playing screen; it is still the button's path on iOS 16, where intents
/// cannot be attached to a widget at all.
struct PlaybackToggleIntent: AppIntent {
    static var openAppWhenRun: Bool { false }

    static var title: LocalizedStringResource = "Play or Pause"

    func perform() async throws -> some IntentResult {
        PlaybackToggleRelay.request()
        return .result()
    }
}

/// One press, carried from wherever the intent ran to the JavaScript that
/// owns the queue. The flag is the road: it survives any process, and the
/// app takes it back whichever way it is woken - on the notification, on
/// its own poll, or on the next launch if it was not up to hear either.
enum PlaybackToggleRelay {
    /// Key and note, as `HomeWidgetModule` spells them: that module compiles
    /// into the app and this file into the extension, so the two sides name
    /// each other's strings the way `nowPlaying` already does. The value is
    /// the time of the press, and a press older than the window the module
    /// allows toggles nothing when it is finally read.
    static let pendingKey = "pendingPlaybackToggle"
    static let noteName = "ResonusPlaybackToggle"

    /// The cross-process half of the note: `NotificationCenter.default`
    /// stays inside one process, and the extension is not the app's. The app
    /// observes this Darwin notification in `HomeWidgetModule`.
    static let darwinNote = "com.juananzzz.resonus.playbackToggle"

    /// The refresh task that gets the app running when nothing else can.
    /// This extension schedules it, the app registers it in its AppDelegate
    /// (both plists permit it), and the system launches the app in the
    /// background to run it - JavaScript then takes the press on startup,
    /// while the handler keeps the process up long enough to play.
    static let refreshTask = "com.juananzzz.resonus.pendingPressRefresh"

    static func request() {
        let now = Date().timeIntervalSince1970
        for group in SharedAppGroup.granted() {
            guard let defaults = UserDefaults(suiteName: group) else { continue }
            defaults.set(now, forKey: pendingKey)
            // This process dies the moment `perform()` returns: flush the
            // write, or the press can die with it before the app ever reads.
            defaults.synchronize()
        }
        // Two roads for an app that is up to hear it: the local note when
        // the intent happened to run in its own process, the Darwin one when
        // it ran here and the app's process is merely alive.
        NotificationCenter.default.post(name: Notification.Name(noteName), object: nil)
        CFNotificationCenterPostNotification(
            CFNotificationCenterGetDarwinNotifyCenter(),
            CFNotificationName(darwinNote as CFString),
            nil,
            nil,
            true
        )
        // And the road for an app that is suspended or not up at all: the
        // system relaunches it in the background to run this task. Submitted
        // on every press, so a later press never waits on an earlier one.
        let request = BGAppRefreshTaskRequest(identifier: refreshTask)
        try? BGTaskScheduler.shared.submit(request)
    }
}
