import ExpoModulesCore
import Foundation
import WidgetKit

public class HomeWidgetModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HomeWidget")

    Function("update") { (state: [String: Any]) in
      HomeWidgetStore.write(state)
    }

    /// What the app can see of its own handover, read back from the group it
    /// writes into. For Settings › Diagnostics: a widget showing only its
    /// icon looks the same whether the group was never granted, the write
    /// never happened, or the data went down on the way out — and on a
    /// sideloaded build, which group the profile even granted.
    Function("status") { () -> String in
      HomeWidgetStore.status()
    }
  }
}

private enum HomeWidgetStore {
  private static let stateKey = "nowPlaying"
  private static let artworkName = "cover.jpg"

  /// The groups this build was granted, of which there may be none. Fixed for
  /// the life of the process, because the entitlements are.
  private static let groups = SharedAppGroup.granted()

  /// The cover currently on file, so a slow download for the previous track
  /// cannot land on top of this one's.
  private static var artworkSource: String?

  private static func containers() -> [URL] {
    groups.compactMap { FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: $0) }
  }

  static func write(_ state: [String: Any]) {
    guard !groups.isEmpty else { return }
    let now = Date().timeIntervalSince1970

    if ((state["active"] as? Bool) ?? false) {
      let payload: [String: Any] = [
        "title": (state["title"] as? String) ?? "",
        "artist": (state["artist"] as? String) ?? "",
        "albumId": (state["albumId"] as? String) ?? "",
        "playing": (state["playing"] as? Bool) ?? false,
        "position": seconds(state["position"]),
        "duration": seconds(state["duration"]),
        "updated": now,
        "fallback": (state["fallback"] as? String) ?? "#141619",
        "accent": (state["accent"] as? String) ?? "",
      ]
      if let data = try? JSONSerialization.data(withJSONObject: payload) {
        for group in groups {
          UserDefaults(suiteName: group)?.set(data, forKey: stateKey)
        }
      }
      if let artwork = (state["artworkUrl"] as? String), !artwork.isEmpty {
        storeArtwork(artwork)
      } else {
        artworkSource = nil
        removeArtwork()
      }
    } else if var kept = existing() {
      // Nothing is playing: the widget holds on to the track that was, stopped
      // where it stopped. Clearing instead would empty it for the seconds a
      // cold start takes to bring the queue back, and for good whenever the
      // app opens with no queue at all.
      kept["playing"] = false
      kept["updated"] = now
      if let patched = try? JSONSerialization.data(withJSONObject: kept) {
        for group in groups {
          UserDefaults(suiteName: group)?.set(patched, forKey: stateKey)
        }
      }
    } else {
      return
    }

    WidgetCenter.shared.reloadAllTimelines()
  }

  /// The last write, in whichever of the groups has one.
  private static func existing() -> [String: Any]? {
    for group in groups {
      guard let data = UserDefaults(suiteName: group)?.data(forKey: stateKey) else { continue }
      if let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] {
        return object
      }
    }
    return nil
  }

  /// `0` for anything that is not a number: a `NaN` reaching the serializer
  /// would take the whole write down with it, and the widget has no use for
  /// one anyway.
  private static func seconds(_ value: Any?) -> Double {
    let n: Double
    if let number = value as? NSNumber { n = number.doubleValue }
    else if let value = value as? Double { n = value }
    else if let value = value as? Int { n = Double(value) }
    else { return 0 }
    return n.isFinite ? n : 0
  }

  /// The handover looked at from this side. English, like the screen it is
  /// read off: it ends up in a bug report. The profile and the granted groups
  /// come first because a sideload takes both from the signer's profile, not
  /// from this repo, and which of the two is missing decides where the fault
  /// is — nobody here can fix a certificate that registered no app group.
  static func status() -> String {
    var parts: [String] = []
    if let id = Bundle.main.bundleIdentifier { parts.append("id \(id)") }

    let profile = SharedAppGroup.profile()
    if !profile.found {
      parts.append("no embedded.mobileprovision")
    } else if profile.groups.isEmpty {
      parts.append("profile has no groups")
    } else {
      parts.append("profile: \(profile.groups.joined(separator: ", "))")
    }

    if groups.isEmpty {
      parts.append("granted: none")
      return parts.joined(separator: " · ")
    }
    parts.append("granted: \(groups.joined(separator: ", "))")

    var unreadable = false
    for group in groups {
      guard let data = UserDefaults(suiteName: group)?.data(forKey: stateKey) else { continue }
      guard
        let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
        let written = (object["updated"] as? NSNumber)?.doubleValue
      else {
        unreadable = true
        continue
      }
      let format = DateFormatter()
      format.dateFormat = "HH:mm:ss"
      parts.append("written \(format.string(from: Date(timeIntervalSince1970: written)))")
      return parts.joined(separator: " · ")
    }
    parts.append(unreadable ? "data unreadable" : "nothing written")
    return parts.joined(separator: " · ")
  }

  private static func storeArtwork(_ source: String) {
    artworkSource = source
    let url = URL(string: source)

    if let url, url.isFileURL, let data = try? Data(contentsOf: url) {
      saveArtwork(data)
      return
    }
    if source.hasPrefix("/"), let data = FileManager.default.contents(atPath: source) {
      saveArtwork(data)
      return
    }
    if let url, let scheme = url.scheme, scheme == "http" || scheme == "https" {
      // The cover is still on the server: fetched here, in the app, so the
      // widget itself never has to reach out for anything.
      URLSession.shared.dataTask(with: url) { data, _, _ in
        guard let data, !data.isEmpty else { return }
        DispatchQueue.main.async {
          guard artworkSource == source else { return }
          saveArtwork(data)
          WidgetCenter.shared.reloadAllTimelines()
        }
      }.resume()
      return
    }

    artworkSource = nil
    removeArtwork()
  }

  private static func saveArtwork(_ data: Data) {
    for dir in containers() {
      try? data.write(to: dir.appendingPathComponent(artworkName), options: .atomic)
    }
  }

  private static func removeArtwork() {
    for dir in containers() {
      try? FileManager.default.removeItem(at: dir.appendingPathComponent(artworkName))
    }
  }
}
