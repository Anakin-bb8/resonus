Pod::Spec.new do |s|
  s.name           = 'audio-route'
  s.version        = '0.0.1'
  s.summary        = 'Audio output route bridge for Resonus'
  s.description    = 'Audio output route bridge for Resonus (local Expo module)'
  s.authors        = 'Resonus'
  s.homepage       = 'https://github.com/juananzzz/resonus'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
