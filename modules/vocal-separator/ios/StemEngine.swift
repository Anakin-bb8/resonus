import AVFoundation
import Foundation

/**
 * Everything the voice models need while a song plays: the loaded model, the
 * mix, and the tap on the player's current item.
 *
 * expo-audio tells this where the player is: it posts `playerReady` (with the
 * `AVPlayer` as the notification's object) once an item is ready and again after
 * every gapless move, and `playerGone` when a player is torn down. That is the
 * whole coupling to expo-audio — see the two `NotificationCenter.default.post`
 * calls the Resonus build adds to `AudioPlayer.swift`.
 */
final class StemEngine {
  static let shared = StemEngine()

  private let tapInstaller = StemTapInstaller()
  private let worker = StemWorker()

  private var model: StemModel?
  private var enabled = false
  private var mix: Float = 0.5
  private var workerActive = false
  private var observers: [NSObjectProtocol] = []
  private weak var player: AVPlayer?

  private init() {}

  // MARK: - Wiring to expo-audio

  func start() {
    guard observers.isEmpty else { return }
    let center = NotificationCenter.default
    observers.append(center.addObserver(
      forName: Notification.Name("resonus.vocalRemoval.playerReady"),
      object: nil, queue: nil
    ) { [weak self] note in
      guard let self, let player = note.object as? AVPlayer else { return }
      self.player = player
      self.attach()
    })
    observers.append(center.addObserver(
      forName: Notification.Name("resonus.vocalRemoval.playerGone"),
      object: nil, queue: nil
    ) { [weak self] note in
      guard let self, let player = note.object as? AVPlayer, player === self.player else { return }
      self.detach()
      self.player = nil
    })
  }

  func stop() {
    for observer in observers {
      NotificationCenter.default.removeObserver(observer)
    }
    observers.removeAll()
    detach()
    player = nil
  }

  // MARK: - The model

  /// Loads an installed `.mlmodelc` bundle. The `kind` the caller passes only
  /// picks which voice the app offered; the path is the model that loads.
  func loadModel(uri: String) -> Bool {
    guard StemModel.isSupported else { return false }
    guard let url = URL(string: uri) else { return false }
    do {
      let loaded = try StemModel(contentsOf: url)
      model = loaded
      attach()
      return true
    } catch {
      model = nil
      return false
    }
  }

  func unload() {
    detach()
    worker.end()
    workerActive = false
    model = nil
  }

  func setEnabled(_ on: Bool) {
    enabled = on
    if on {
      attach()
    } else {
      detach()
    }
  }

  func setMix(_ value: Float) {
    mix = min(1, max(0, value))
  }

  // MARK: - The tap

  private func attach() {
    guard enabled, model != nil, let item = player?.currentItem else { return }
    // A fresh item means fresh audio: start the pipeline over.
    workerActive = false
    _ = tapInstaller.install(engine: self, on: item)
  }

  private func detach() {
    tapInstaller.uninstall()
    workerActive = false
  }

  /// Called on the audio thread by the tap. The gains are the mix: 0 is the
  /// background alone, 0.5 the original track, 1 the voices alone.
  func process(bufferList: UnsafeMutablePointer<AudioBufferList>, frames: Int, nonInterleaved: Bool, channels: Int) {
    guard enabled, let model, frames > 0 else { return }
    if !workerActive {
      worker.begin(model: model, channels: channels)
      workerActive = true
    }
    worker.push(bufferList: UnsafePointer(bufferList), frames: frames, nonInterleaved: nonInterleaved)
    let buffers = UnsafeMutableAudioBufferListPointer(bufferList)
    worker.pull(
      into: buffers,
      frames: frames,
      nonInterleaved: nonInterleaved,
      voiceGain: min(1, 2 * mix),
      backgroundGain: min(1, 2 * (1 - mix)))
  }
}
