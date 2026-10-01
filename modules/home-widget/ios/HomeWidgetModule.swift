import ExpoModulesCore
import Foundation
import WidgetKit

/// The App Group the app writes into and the widget reads from. Both sides
/// name it themselves: the extension is a separate binary and never links this
/// module, it only shares the container.
let homeWidgetAppGroup = "group.com.juananzzz.resonus"

public class HomeWidgetModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HomeWidget")

    Function("update") { (state: [String: Any]) in
      HomeWidgetStore.write(state)
    }
  }
}

private enum HomeWidgetStore {
  private static let stateKey = "nowPlaying"
  private static let artworkName = "cover.jpg"

  /// The cover currently on file, so a slow download for the previous track
  /// cannot land on top of this one's.
  private static var artworkSource: String?

  private static var defaults: UserDefaults? { UserDefaults(suiteName: homeWidgetAppGroup) }

  private static var container: URL? {
    FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: homeWidgetAppGroup)
  }

  static func write(_ state: [String: Any]) {
    guard let defaults else { return }
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
      ]
      if let data = try? JSONSerialization.data(withJSONObject: payload) {
        defaults.set(data, forKey: stateKey)
      }
      if let artwork = (state["artworkUrl"] as? String), !artwork.isEmpty {
        storeArtwork(artwork)
      } else {
        artworkSource = nil
        removeArtwork()
      }
    } else if let data = defaults.data(forKey: stateKey),
              var kept = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] {
      // Nothing is playing: the widget holds on to the track that was, stopped
      // where it stopped. Clearing instead would empty it for the seconds a
      // cold start takes to bring the queue back, and for good whenever the
      // app opens with no queue at all.
      kept["playing"] = false
      kept["updated"] = now
      if let patched = try? JSONSerialization.data(withJSONObject: kept) {
        defaults.set(patched, forKey: stateKey)
      }
    } else {
      return
    }

    WidgetCenter.shared.reloadAllTimelines()
  }

  private static func seconds(_ value: Any?) -> Double {
    if let number = value as? NSNumber { return number.doubleValue }
    if let value = value as? Double { return value }
    if let value = value as? Int { return Double(value) }
    return 0
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
    guard let dir = container else { return }
    try? data.write(to: dir.appendingPathComponent(artworkName), options: .atomic)
  }

  private static func removeArtwork() {
    guard let dir = container else { return }
    try? FileManager.default.removeItem(at: dir.appendingPathComponent(artworkName))
  }
}
