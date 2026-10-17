import AudioToolbox
import AVFoundation
import Foundation

/**
 * The processing tap the separator hangs on the playing item. It is a
 * POST-effects tap, so what it writes into the buffer is what comes out of the
 * player: the engine reads the original, feeds it to the worker, and writes the
 * mix back. The plain, read-only tap expo-audio owns for sampling is a
 * different one and is left alone (the app never samples).
 *
 * The C callbacks cannot capture, so the engine they must reach travels in the
 * tap's storage: retained in `init`, released in `finalize`.
 */
final class StemTapContext {
  unowned let engine: StemEngine
  var nonInterleaved = false
  var channels = 2

  init(engine: StemEngine) {
    self.engine = engine
  }
}

/// Owns the tap and the audio mix for the item under it.
final class StemTapInstaller {
  private var tap: MTAudioProcessingTap?
  private var context: StemTapContext?
  private weak var item: AVPlayerItem?

  func install(engine: StemEngine, on item: AVPlayerItem) -> Bool {
    uninstall()
    guard let track = item.tracks.first(where: { $0.assetTrack != nil })?.assetTrack else {
      return false
    }
    let context = StemTapContext(engine: engine)
    var callbacks = MTAudioProcessingTapCallbacks(
      version: kMTAudioProcessingTapCallbacksVersion_0,
      clientInfo: Unmanaged.passRetained(context).toOpaque(),
      `init`: stemTapInit,
      finalize: stemTapFinalize,
      prepare: stemTapPrepare,
      unprepare: nil,
      process: stemTapProcess)
    var tap: MTAudioProcessingTap?
    let status = MTAudioProcessingTapCreate(
      kCFAllocatorDefault, &callbacks, kMTAudioProcessingTapCreationFlag_PostEffects, &tap)
    guard status == noErr, let tap else {
      Unmanaged<StemTapContext>.fromOpaque(callbacks.clientInfo!).release()
      return false
    }
    let parameters = AVMutableAudioMixInputParameters(track: track)
    parameters.audioTapProcessor = tap
    let mix = AVMutableAudioMix()
    mix.inputParameters = [parameters]
    item.audioMix = mix
    self.tap = tap
    self.context = context
    self.item = item
    return true
  }

  func uninstall() {
    item?.audioMix = nil
    item = nil
    context = nil
    tap = nil
  }
}

// MARK: - The tap's C callbacks

private func context(of tap: MTAudioProcessingTap) -> StemTapContext? {
  // `GetStorage` is a non-optional pointer in Swift; it is live from `init` on.
  let storage = MTAudioProcessingTapGetStorage(tap)
  return Unmanaged<StemTapContext>.fromOpaque(storage).takeUnretainedValue()
}

private func stemTapInit(
  _ tap: MTAudioProcessingTap,
  _ clientInfo: UnsafeMutableRawPointer?,
  _ tapStorageOut: UnsafeMutablePointer<UnsafeMutableRawPointer?>
) {
  // The reference `passRetained` put on the context is handed to the tap here
  // and taken back in `stemTapFinalize`.
  tapStorageOut.pointee = clientInfo
}

private func stemTapFinalize(_ tap: MTAudioProcessingTap) {
  let storage = MTAudioProcessingTapGetStorage(tap)
  Unmanaged<StemTapContext>.fromOpaque(storage).release()
}

private func stemTapPrepare(
  _ tap: MTAudioProcessingTap,
  _ maxFrames: CMItemCount,
  _ format: UnsafePointer<AudioStreamBasicDescription>
) {
  guard let context = context(of: tap) else { return }
  context.nonInterleaved = format.pointee.mFormatFlags & kAudioFormatFlagIsNonInterleaved != 0
  context.channels = Int(format.pointee.mChannelsPerFrame)
}

private func stemTapProcess(
  _ tap: MTAudioProcessingTap,
  _ numberFrames: CMItemCount,
  _ flags: MTAudioProcessingTapFlags,
  _ bufferListInOut: UnsafeMutablePointer<AudioBufferList>,
  _ numberFramesOut: UnsafeMutablePointer<CMItemCount>,
  _ flagsOut: UnsafeMutablePointer<MTAudioProcessingTapFlags>
) {
  let status = MTAudioProcessingTapGetSourceAudio(
    tap, numberFrames, bufferListInOut, flagsOut, nil, numberFramesOut)
  guard status == noErr, let context = context(of: tap) else { return }
  context.engine.process(
    bufferList: bufferListInOut,
    frames: Int(numberFramesOut.pointee),
    nonInterleaved: context.nonInterleaved,
    channels: context.channels)
}
