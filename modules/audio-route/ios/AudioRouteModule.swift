import AVFoundation
import ExpoModulesCore

/**
 * Where the phone's own sound is going, from AVAudioSession. Route info needs
 * no permission and no entitlement: the port name is what the system calls
 * the device ("AirPods Pro"), and the route change notification fires on
 * every plug, pairing and handoff.
 */
public class AudioRouteModule: Module {
  private var observer: NSObjectProtocol?

  private func kind(of port: AVAudioSession.Port) -> String {
    switch port {
    case .bluetoothA2DP, .bluetoothLE, .bluetoothHFP:
      return "bluetooth"
    case .headphones, .headsetMic, .usbAudio, .lineOut:
      return "wired"
    case .builtInSpeaker, .builtInReceiver:
      return "builtin"
    case .carAudio:
      return "car"
    case .airPlay:
      return "airplay"
    default:
      return "other"
    }
  }

  private func currentRoute() -> [String: String] {
    guard let output = AVAudioSession.sharedInstance().currentRoute.outputs.first else {
      return ["kind": "builtin", "name": ""]
    }
    let kind = kind(of: output.portType)
    // The speaker's port name is just "Speaker", which says nothing.
    return ["kind": kind, "name": kind == "builtin" ? "" : output.portName]
  }

  public func definition() -> ModuleDefinition {
    Name("AudioRoute")

    Events("routeChanged")

    Function("getRoute") { () -> [String: String] in
      return self.currentRoute()
    }

    OnCreate {
      self.observer = NotificationCenter.default.addObserver(
        forName: AVAudioSession.routeChangeNotification,
        object: nil,
        queue: nil
      ) { [weak self] _ in
        guard let self else { return }
        self.sendEvent("routeChanged", self.currentRoute())
      }
    }

    OnDestroy {
      if let observer = self.observer {
        NotificationCenter.default.removeObserver(observer)
        self.observer = nil
      }
    }
  }
}
