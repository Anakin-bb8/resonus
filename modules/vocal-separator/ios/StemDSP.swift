import Accelerate
import Foundation

/**
 * The short-time Fourier transform the voice models were trained on, and its
 * inverse. The numbers are not free: the models were exported from a Python
 * pipeline (Demucs-style) that used this exact grid, and the Neural Engine
 * expects the spectrum laid out on it. Every constant here matches the Taurus
 * tweak's `SGStemSpectralDSP` and the model's `model.mil`.
 *
 * 44100 Hz, 2048-point FFT, hop 441, a periodic Hann window, centred frames
 * (the signal is padded by half a window at both ends, reflect-style), giving
 * 1025 frequency bins and 201 frames for a two-second window.
 */
enum StemGrid {
  static let sampleRate = 44_100
  static let nFFT = 2048
  static let log2n = vDSP_Length(11)
  static let hop = 441
  static let bins = nFFT / 2 + 1            // 1025
  static let windowSamples = sampleRate * 2 // two seconds
  static let windowFrames = windowSamples / hop + 1 // 201, centred
  static let hopFrames = (sampleRate * 3 / 2) / hop  // 1.5 s between windows
  static let overlapFrames = windowFrames - hopFrames // 0.5 s of overlap
}

/// A real-to-complex FFT pair (vDSP), preallocated so the audio thread never
/// allocates: the tap calls it dozens of times a second.
final class RealFFT {
  private let setup: FFTSetup
  private var window: [Float]

  init() {
    setup = vDSP_create_fftsetup(StemGrid.log2n, FFTRadix(kFFTRadix2))!
    // Periodic Hann: 0.5 - 0.5*cos(2*pi*n/N). Periodic, not symmetric, because
    // that is what the training pipeline used (librosa's default).
    var w = [Float](repeating: 0, count: StemGrid.nFFT)
    vDSP_hann_window(&w, vDSP_Length(StemGrid.nFFT), Int32(vDSP_HANN_DENORM))
    window = w
  }

  deinit {
    vDSP_destroy_fftsetup(setup)
  }

  /// Applies the analysis window, then the forward transform.
  func forward(_ input: UnsafePointer<Float>, real outReal: UnsafeMutablePointer<Float>, imag outImag: UnsafeMutablePointer<Float>) {
    var buffered = [Float](repeating: 0, count: StemGrid.nFFT)
    vDSP_vmul(input, 1, window, 1, &buffered, 1, vDSP_Length(StemGrid.nFFT))

    var re = [Float](repeating: 0, count: StemGrid.nFFT / 2)
    var im = [Float](repeating: 0, count: StemGrid.nFFT / 2)
    buffered.withUnsafeBufferPointer { bp in
      let asComplex = UnsafeRawPointer(bp.baseAddress!).assumingMemoryBound(to: DSPComplex.self)
      re.withUnsafeMutableBufferPointer { rp in
        im.withUnsafeMutableBufferPointer { ip in
          var split = DSPSplitComplex(realp: rp.baseAddress!, imagp: ip.baseAddress!)
          // Even/odd samples packed into a half-length complex signal.
          vDSP_ctoz(asComplex, 2, &split, 1, vDSP_Length(StemGrid.nFFT / 2))
          vDSP_fft_zrip(setup, &split, 1, StemGrid.log2n, FFTDirection(FFT_FORWARD))
          // Unpack. DC and Nyquist share re[0]/im[0]; the rest are halved as
          // vDSP leaves the forward transform scaled by two.
          outReal[0] = re[0]
          outImag[0] = 0
          outReal[StemGrid.bins - 1] = im[0]
          outImag[StemGrid.bins - 1] = 0
          for i in 1..<(StemGrid.nFFT / 2) {
            outReal[i] = re[i] * 0.5
            outImag[i] = im[i] * 0.5
          }
        }
      }
    }
  }

  /// The inverse transform, scaled so that forward→inverse is the identity on a
  /// windowed frame. The caller overlap-adds the frames.
  func inverse(_ real: UnsafePointer<Float>, _ imag: UnsafePointer<Float>, out: UnsafeMutablePointer<Float>) {
    var re = [Float](repeating: 0, count: StemGrid.nFFT / 2)
    var im = [Float](repeating: 0, count: StemGrid.nFFT / 2)
    re[0] = real[0]
    im[0] = real[StemGrid.bins - 1]
    for i in 1..<(StemGrid.nFFT / 2) {
      re[i] = real[i]
      im[i] = imag[i]
    }
    var buffered = [Float](repeating: 0, count: StemGrid.nFFT)
    re.withUnsafeMutableBufferPointer { rp in
      im.withUnsafeMutableBufferPointer { ip in
        var split = DSPSplitComplex(realp: rp.baseAddress!, imagp: ip.baseAddress!)
        vDSP_fft_zrip(setup, &split, 1, StemGrid.log2n, FFTDirection(FFT_INVERSE))
        let asComplex = UnsafeMutableRawPointer(mutating: buffered).assumingMemoryBound(to: DSPComplex.self)
        vDSP_ztoc(&split, 1, asComplex, 2, vDSP_Length(StemGrid.nFFT / 2))
      }
    }
    // vDSP's unnormalised inverse leaves a factor of 2*N; the window, applied
    // once, brings it back to the identity the overlap-add expects.
    var scale = Float(1.0 / Double(StemGrid.nFFT))
    vDSP_vsmul(buffered, 1, &scale, &buffered, 1, vDSP_Length(StemGrid.nFFT))
    vDSP_vmul(buffered, 1, window, 1, out, 1, vDSP_Length(StemGrid.nFFT))
  }
}
