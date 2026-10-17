Pod::Spec.new do |s|
  s.name           = 'vocal-separator'
  s.version        = '0.0.1'
  s.summary        = 'Voice removal (Karaoke) bridge for Resonus'
  s.description    = 'Runs the karaoke voice models over the playing audio (local Expo module)'
  s.authors        = 'Resonus'
  s.homepage       = 'https://github.com/juananzzz/resonus'
  # The models are Core ML bundles built for iOS 18 (the Neural Engine layout
  # and the ML Program spec 9 they need did not exist before it), but that is a
  # *runtime* limit: the pod itself must build against the app's floor, or
  # CocoaPods refuses to install it for every target. `StemModel.isSupported`
  # gates the iOS 18 check at runtime instead.
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'CoreML', 'Accelerate', 'AVFoundation', 'AudioToolbox'
  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
