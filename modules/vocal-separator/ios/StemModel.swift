import CoreML
import Foundation

/**
 * One of the two published voice models, loaded onto the Neural Engine. The
 * bundles (`separator-ane.mlmodelc`, `separator-light.mlmodelc`) are compiled
 * Core ML packages from Taurus's Sing, not sources we build here: they are
 * downloaded whole, hash-checked and then loaded by path.
 *
 * The model eats a spectrum, not samples: a `[1,2050,201,2]` tensor — the two
 * stereo channels' 1025 bins, over 201 frames, each a real/imaginary pair —
 * and gives back the same tensor for the isolated voice. The STFT and its
 * inverse live in `StemDSP`; this type only moves tensors.
 */
final class StemModel {
  private let model: MLModel
  private let inputName: String
  private let outputName: String

  /// Cheapest possible check: the Neural Engine path needs a modern OS and the
  /// Core ML Program format these bundles are in.
  static var isSupported: Bool {
    if #available(iOS 18.0, *) {
      return true
    }
    return false
  }

  init(contentsOf url: URL) throws {
    let config = MLModelConfiguration()
    // The models were exported for the ANE; letting Core ML keep CPU/GPU as an
    // escape hatch is what makes a device without a free ANE still work, only
    // slower.
    config.computeUnits = .cpuAndNeuralEngine
    config.allowLowPrecisionAccumulationOnGPU = true
    model = try MLModel(contentsOf: url, configuration: config)

    let description = model.modelDescription
    guard let input = description.inputDescriptionsByName.first,
      input.value.type == .multiArray,
      let output = description.outputDescriptionsByName.first,
      output.value.type == .multiArray else {
      throw StemModelError.unexpectedShape
    }
    inputName = input.key
    outputName = output.key
    let shape = input.value.multiArrayConstraint?.shape.map { $0.intValue }
    guard shape == [1, 2050, 201, 2] else {
      throw StemModelError.unexpectedShape
    }
  }

  /// Runs one two-second window and hands back its voices-only spectrum, in the
  /// same `[1,2050,201,2]` layout it was given.
  func predict(input: MLMultiArray) throws -> MLMultiArray {
    let provider = try MLDictionaryFeatureProvider(dictionary: [inputName: MLFeatureValue(multiArray: input)])
    let result = try model.prediction(from: provider)
    guard let spectrum = result.featureValue(for: outputName)?.multiArrayValue else {
      throw StemModelError.unexpectedShape
    }
    return spectrum
  }
}

enum StemModelError: Error {
  case unexpectedShape
}
