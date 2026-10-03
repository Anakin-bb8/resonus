import AppIntents
import Foundation

/// The widget's play/pause button: one press, the player toggles, and the
/// app never comes up. `openAppWhenRun` false is the point of the whole
/// file — with it the system runs the intent on its own, the app is neither
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
/// app takes it back whichever way it is woken — on the notification, on
/// its own poll, or on the next launch if it was not up to hear either.
enum PlaybackToggleRelay {
    /// Key and note, as `HomeWidgetModule` spells them: that module compiles
    /// into the app and this file into the extension, so the two sides name
    /// each other's strings the way `nowPlaying` already does. The value is
    /// the time of the press, and a press older than the window the module
    /// allows toggles nothing when it is finally read.
    static let pendingKey = "pendingPlaybackToggle"
    static let noteName = "ResonusPlaybackToggle"

    static func request() {
        let now = Date().timeIntervalSince1970
        for group in SharedAppGroup.granted() {
            UserDefaults(suiteName: group)?.set(now, forKey: pendingKey)
        }
        NotificationCenter.default.post(name: Notification.Name(noteName), object: nil)
    }
}
