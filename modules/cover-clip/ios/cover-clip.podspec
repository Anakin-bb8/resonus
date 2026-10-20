Pod::Spec.new do |s|
  s.name           = 'cover-clip'
  s.version        = '0.0.1'
  s.summary        = 'Decorative looping cover clips for Resonus'
  s.description    = 'Decorative looping cover clips for Resonus (local Expo module, iOS only)'
  s.authors        = 'Resonus'
  s.homepage       = 'https://github.com/juananzzz/resonus'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
