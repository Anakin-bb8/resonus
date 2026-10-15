import ExpoModulesCore
import AVFoundation

/**
 * Decorative cover clips: HLS video rendered through a bare AVPlayerLayer,
 * never an AVPlayerViewController.
 *
 * The controller is what breaks the app's audio lock screen: once any
 * AVPlayerViewController has presented video, the song's Now Playing updates
 * stop surfacing (lock screen, Control Center, Island, headphones) while the
 * audio keeps playing - muted or not, and even with
 * `updatesNowPlayingInfoCenter` off. A layer-backed AVPlayer leaves the audio
 * session, the Now Playing center and the remote commands alone.
 *
 * So this module holds no session code, no Now Playing, no remote commands -
 * on purpose. The player is muted eye-candy over music expo-audio owns.
 */
public class CoverClipModule: Module {
  public func definition() -> ModuleDefinition {
    Name("CoverClip")

    View(CoverClipView.self) {
      Prop("uri") { (view: CoverClipView, uri: String?) in
        view.setUri(uri)
      }
    }
  }
}

public final class CoverClipView: ExpoView {
  private var player: AVPlayer?
  private var endObserver: NSObjectProtocol?
  private let playerLayer = AVPlayerLayer()

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    playerLayer.videoGravity = .resizeAspectFill
    layer.addSublayer(playerLayer)
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    playerLayer.frame = bounds
  }

  func setUri(_ raw: String?) {
    teardown()
    guard let raw, let uri = URL(string: raw) else { return }
    let player = AVPlayer(url: uri)
    player.isMuted = true
    player.preventsDisplaySleepDuringVideoPlayback = false
    playerLayer.player = player
    self.player = player
    endObserver = NotificationCenter.default.addObserver(
      forName: .AVPlayerItemDidPlayToEndTime,
      object: player.currentItem,
      queue: .main
    ) { [weak self] _ in
      self?.player?.seek(to: .zero)
      self?.player?.play()
    }
    player.play()
  }

  private func teardown() {
    if let endObserver {
      NotificationCenter.default.removeObserver(endObserver)
      self.endObserver = nil
    }
    player?.pause()
    playerLayer.player = nil
    player = nil
  }

  deinit {
    teardown()
  }
}
