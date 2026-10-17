import AudioToolbox
import CoreML
import Foundation

/**
 * Turns a stream of original audio into the isolated voice, window by window.
 *
 * The window is two seconds long and the model separates a whole window at a
 * time, so the voices for a moment cannot exist until two seconds of that
 * moment have passed: everything this hands back lags the input by one window.
 * The caller (the tap) mixes the delayed original with these voices, which is
 * why `pull` returns BOTH — the original it must be mixed against, and the
 * voices — already lined up sample for sample.
 *
 * Consecutive windows overlap by half a second and are crossfaded, so the seam
 * between them is not heard. The numbers come from `StemGrid` and match the
 * models' training pipeline (see `StemDSP`).
 */
final class StemWorker {
  private let fft = RealFFT()
  private var model: StemModel?

  private(set) var channels = 2
  private(set) var active = false

  private var windowSamples = StemGrid.windowSamples
  private var overlapSamples = StemGrid.overlapFrames * StemGrid.hop
  private var stride = StemGrid.hopFrames * StemGrid.hop // what each window adds

  /// The window being filled, per channel, and how much of it is filled.
  private var input: [[Float]] = []
  private var filled = 0

  /// Finished output, per channel: the original each block must be mixed
  /// against, and the voices. Read in lockstep; `outRead` is where both are.
  private var outOriginal: [[Float]] = []
  private var outVoices: [[Float]] = []
  private var outRead = 0

  /// The half second carried between windows, per channel.
  private var tail: [[Float]] = []
  private var windowsProduced = 0

  // Scratch, allocated once: none of this may allocate while audio is flowing.
  private var windowed: [[Float]] = []
  private var frameScratch = [Float](repeating: 0, count: StemGrid.nFFT)
  private var spectrumReal: [[Float]] = []
  private var spectrumImag: [[Float]] = []
  private var inputArray: MLMultiArray?

  func begin(model: StemModel?, channels: Int) {
    self.model = model
    self.channels = max(1, min(2, channels))
    active = model != nil
    input = Array(repeating: [Float](repeating: 0, count: windowSamples), count: self.channels)
    windowed = Array(repeating: [Float](repeating: 0, count: windowSamples), count: self.channels)
    spectrumReal = Array(repeating: [Float](repeating: 0, count: StemGrid.bins), count: self.channels)
    spectrumImag = Array(repeating: [Float](repeating: 0, count: StemGrid.bins), count: self.channels)
    outOriginal = Array(repeating: [], count: self.channels)
    outVoices = Array(repeating: [], count: self.channels)
    tail = Array(repeating: [Float](repeating: 0, count: overlapSamples), count: self.channels)
    inputArray = try? MLMultiArray(shape: [1, 2050, 201, 2], dataType: .float32)
    filled = 0
    outRead = 0
    windowsProduced = 0
  }

  func end() {
    active = false
    model = nil
  }

  /// How many samples of aligned output are ready to pull.
  var readyCount: Int {
    guard let first = outVoices.first else { return 0 }
    return max(0, first.count - outRead)
  }

  /** Feeds `frames` samples in and produces another window whenever one fills. */
  func push(bufferList: UnsafePointer<AudioBufferList>, frames: Int, nonInterleaved: Bool) {
    guard active, model != nil, inputArray != nil else { return }
    guard frames > 0 else { return }
    let buffers = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: bufferList))
    let interleavedChannels = nonInterleaved ? 1 : max(1, Int(buffers[0].mNumberChannels))

    var offset = 0
    while offset < frames {
      let room = windowSamples - filled
      let take = min(room, frames - offset)
      for ch in 0..<channels {
        let bufferIndex = nonInterleaved ? min(ch, buffers.count - 1) : 0
        guard let src = buffers[bufferIndex].mData?.assumingMemoryBound(to: Float.self) else { continue }
        let channelOffset = nonInterleaved ? 0 : min(ch, interleavedChannels - 1)
        for i in 0..<take {
          input[ch][filled + i] = src[(offset + i) * interleavedChannels + channelOffset]
        }
      }
      filled += take
      offset += take
      if filled == windowSamples {
        produceWindow()
        // Keep the half second the next window shares.
        for ch in 0..<channels {
          input[ch].removeFirst(overlapSamples)
          input[ch].append(contentsOf: repeatElement(0, count: overlapSamples))
        }
        filled = overlapSamples
      }
    }
  }

  /**
   * Writes the mix straight into the tap's buffers, up to `frames` samples:
   * `backgroundGain * (original - voices) + voiceGain * voices`, which is 0
   * (background only), the original (0.5) or the voices alone (1). Anything the
   * pipeline has not reached yet — the first window — is left as it arrived, so
   * the opening of a song is the plain track and not silence. Returns how many
   * samples were written.
   */
  @discardableResult
  func pull(into buffers: UnsafeMutableAudioBufferListPointer, frames: Int, nonInterleaved: Bool, voiceGain: Float, backgroundGain: Float) -> Int {
    let count = min(frames, readyCount)
    if count <= 0 { return 0 }
    let interleavedChannels = nonInterleaved ? 1 : max(1, Int(buffers[0].mNumberChannels))
    for ch in 0..<channels {
      let bufferIndex = nonInterleaved ? min(ch, buffers.count - 1) : 0
      guard let data = buffers[bufferIndex].mData?.assumingMemoryBound(to: Float.self) else { continue }
      let channelOffset = nonInterleaved ? 0 : min(ch, interleavedChannels - 1)
      for i in 0..<count {
        let original = outOriginal[ch][outRead + i]
        let voices = outVoices[ch][outRead + i]
        let background = original - voices
        data[i * interleavedChannels + channelOffset] = backgroundGain * background + voiceGain * voices
      }
    }
    outRead += count
    if outRead > 0, outRead >= (outVoices.first?.count ?? 0) {
      outRead = 0
      for ch in 0..<channels {
        outOriginal[ch].removeAll(keepingCapacity: true)
        outVoices[ch].removeAll(keepingCapacity: true)
      }
    }
    return count
  }

  /// STFT, model, inverse, per channel, then the crossfade against the last
  /// window's tail. The block it emits is the window's first `stride` samples;
  /// its last half second is kept to fade the next window against.
  private func produceWindow() {
    guard let model, let array = inputArray else { return }
    let frames = StemGrid.windowFrames
    let bins = StemGrid.bins
    let pointer = array.dataPointer.assumingMemoryBound(to: Float.self)

    // Layout [1,2050,201,2]: ((channel*bins + bin)*frames + frame)*2 + (0 real, 1 imag).
    for ch in 0..<channels {
      for f in 0..<frames {
        let start = f * StemGrid.hop - StemGrid.nFFT / 2
        for n in 0..<StemGrid.nFFT {
          frameScratch[n] = centred(ch: ch, index: start + n)
        }
        spectrumReal[ch].withUnsafeMutableBufferPointer { rp in
          spectrumImag[ch].withUnsafeMutableBufferPointer { ip in
            frameScratch.withUnsafeBufferPointer { fp in
              fft.forward(fp.baseAddress!, real: rp.baseAddress!, imag: ip.baseAddress!)
            }
          }
        }
        for b in 0..<bins {
          let base = pointer + (ch * bins + b) * frames * 2 + f * 2
          base[0] = spectrumReal[ch][b]
          base[1] = spectrumImag[ch][b]
        }
      }
    }

    guard let output = try? model.predict(input: array) else { return }
    let outPointer = output.dataPointer.assumingMemoryBound(to: Float.self)
    for ch in 0..<channels {
      for i in 0..<windowSamples { windowed[ch][i] = 0 }
      for f in 0..<frames {
        for b in 0..<bins {
          let base = outPointer + (ch * bins + b) * frames * 2 + f * 2
          spectrumReal[ch][b] = base[0]
          spectrumImag[ch][b] = base[1]
        }
        let start = f * StemGrid.hop - StemGrid.nFFT / 2
        spectrumReal[ch].withUnsafeBufferPointer { rp in
          spectrumImag[ch].withUnsafeBufferPointer { ip in
            frameScratch.withUnsafeMutableBufferPointer { sp in
              fft.inverse(rp.baseAddress!, ip.baseAddress!, out: sp.baseAddress!)
              for n in 0..<StemGrid.nFFT {
                let index = start + n
                if index >= 0, index < windowSamples { windowed[ch][index] += frameScratch[n] }
              }
            }
          }
        }
      }
    }

    for ch in 0..<channels {
      if windowsProduced > 0 {
        for i in 0..<overlapSamples {
          let t = Float(i) / Float(overlapSamples)
          windowed[ch][i] = windowed[ch][i] * t + tail[ch][i] * (1 - t)
        }
      }
      outOriginal[ch].append(contentsOf: input[ch][0..<stride])
      outVoices[ch].append(contentsOf: windowed[ch][0..<stride])
      tail[ch] = Array(windowed[ch][stride..<windowSamples])
    }
    windowsProduced += 1
  }

  /// The sample at `index` reflected off the ends, the way a centred STFT pads,
  /// so the first and last frames of the window are not silent.
  private func centred(ch: Int, index: Int) -> Float {
    let count = windowSamples
    if index >= 0, index < count { return input[ch][index] }
    var i = index
    while i < 0 { i = -i }
    while i >= count { i = 2 * count - i - 2 }
    return input[ch][max(0, min(count - 1, i))]
  }
}
