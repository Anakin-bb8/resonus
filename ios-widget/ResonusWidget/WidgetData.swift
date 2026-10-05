import Foundation
import SwiftUI
import UIKit

/// What the app hands the widget, written into the shared App Group container
/// by the `HomeWidget` module. The widget never asks it anything: it reads the
/// last write, and works out how far the track has run from the time that write
/// was made.
struct NowPlaying: Codable {
    var title: String
    var artist: String
    var albumId: String
    var playing: Bool
    var position: Double
    var duration: Double
    var updated: TimeInterval
    var fallback: String
    /// The cover's colour, read off it by the app the way the screens do.
    /// Absent in a handover from a build that did not send one.
    var accent: String?

    var isEmpty: Bool { title.isEmpty && artist.isEmpty }

    static let sample = NowPlaying(
        title: "Nothing",
        artist: "",
        albumId: "",
        playing: false,
        position: 0,
        duration: 0,
        updated: 0,
        fallback: "#141619",
        accent: nil
    )
}

enum WidgetStore {
    static let stateKey = "nowPlaying"
    static let artworkName = "cover.jpg"

    /// The groups this build was granted (see `SharedAppGroup`): the app
    /// writes into all of them, and this reads whichever has something in
    /// it. There may be none, and that is the first thing `why()` says.
    private static let groups = SharedAppGroup.granted()

    static func load() -> NowPlaying? {
        for group in groups {
            guard let data = UserDefaults(suiteName: group)?.data(forKey: stateKey) else { continue }
            if let state = try? JSONDecoder().decode(NowPlaying.self, from: data) { return state }
        }
        return nil
    }

    /// Why there is nothing to show, said the way a bug report needs it said:
    /// which half of the handover is missing, and how many groups were
    /// granted to find it in. English whatever the phone's language, like
    /// everything else here that is meant to be read off a screenshot.
    /// `nil` when there is nothing wrong.
    static func why() -> String? {
        guard !groups.isEmpty else { return "app group not granted" }
        var sawData = false
        for group in groups {
            guard let data = UserDefaults(suiteName: group)?.data(forKey: stateKey) else { continue }
            sawData = true
            if (try? JSONDecoder().decode(NowPlaying.self, from: data)) != nil { return nil }
        }
        let granted = "· granted \(groups.count)"
        return sawData ? "data unreadable \(granted)" : "no data from the app \(granted)"
    }

    /// The cover the app left in a container, if it left one.
    static func artwork() -> UIImage? {
        for group in groups {
            guard let dir = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) else { continue }
            if let image = UIImage(contentsOfFile: dir.appendingPathComponent(artworkName).path) { return image }
        }
        return nil
    }

    /// How much of the track has played as of `date`: what the app recorded,
    /// plus the seconds that have gone by since. Between the app's updates the
    /// bar walks forward on its own this way, and stops the moment the app says
    /// the track is paused (`updated` is the pause, `playing` says so).
    static func progress(_ state: NowPlaying, at date: Date) -> Double {
        guard state.duration > 0 else { return 0 }
        var seconds = state.position
        if state.playing { seconds += date.timeIntervalSince1970 - state.updated }
        return max(0, min(1, seconds / state.duration))
    }

    /// The colour the app read off the cover, in the band the app read it in:
    /// white text has to read on it, so the dark band, whichever theme the
    /// app is in - the widget's text does not follow the theme. The app's own
    /// background stands in when there is no cover, or the handover is from a
    /// build that sent no colour of its own.
    static func background(_ state: NowPlaying?) -> Color {
        if let hex = state?.accent, !hex.isEmpty { return color(hex) }
        return color(state?.fallback ?? "#141619")
    }

    static func color(_ hex: String) -> Color {
        let digits = hex.trimmingCharacters(in: .alphanumerics.inverted)
        guard digits.count == 6, let value = UInt64(digits, radix: 16) else {
            return Color(red: 0.078, green: 0.086, blue: 0.098)
        }
        return Color(
            red: Double((value >> 16) & 0xFF) / 255,
            green: Double((value >> 8) & 0xFF) / 255,
            blue: Double(value & 0xFF) / 255
        )
    }
}
