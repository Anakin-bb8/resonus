import CryptoKit
import ExpoModulesCore
import Foundation

/**
 * The JS surface of vocal removal. All of the work lives in `StemEngine`; this
 * only exposes it, and the SHA-256 used to verify the downloaded models (hashing
 * a 200 MB file has to happen natively, on a background thread, not in JS).
 *
 * iOS 14 is the floor of the app; the module exists there but `isSupported`
 * says no until iOS 18, which is what the models need.
 */
public class VocalSeparatorModule: Module {
  private let engine = StemEngine.shared

  public func definition() -> ModuleDefinition {
    Name("VocalSeparator")

    Function("isSupported") { () -> Bool in
      return StemModel.isSupported
    }

    Function("sha256") { (uri: String) -> String in
      guard let url = URL(string: uri) else { return "" }
      return (try? Self.hash(fileAt: url)) ?? ""
    }

    Function("loadModel") { (uri: String, _: String) -> Bool in
      return self.engine.loadModel(uri: uri)
    }

    Function("unloadModel") {
      self.engine.unload()
    }

    Function("setEnabled") { (enabled: Bool) in
      self.engine.setEnabled(enabled)
    }

    Function("setMix") { (mix: Double) in
      self.engine.setMix(Float(mix))
    }

    OnCreate {
      self.engine.start()
    }

    OnDestroy {
      self.engine.stop()
    }
  }

  /// Streams the file into SHA-256 in megabyte chunks, so a large model never
  /// sits in memory whole.
  private static func hash(fileAt url: URL) throws -> String {
    let handle = try FileHandle(forReadingFrom: url)
    defer { try? handle.close() }
    var hasher = SHA256()
    while true {
      let chunk = try handle.read(upToCount: 1 << 20)
      guard let chunk, !chunk.isEmpty else { break }
      hasher.update(data: chunk)
    }
    return hasher.finalize().map { String(format: "%02x", $0) }.joined()
  }
}
