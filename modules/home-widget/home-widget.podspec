require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'home-widget'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = 'MIT'
  s.author         = 'Resonus'
  s.homepage       = 'https://github.com/juananzzz/resonus'
  s.platforms      = { :ios => '16.4' }
  s.source         = { :git => 'https://github.com/juananzzz/resonus.git', :tag => "v#{s.version}" }
  # What the generated `ExpoModulesProvider` imports this module as: the pod
  # name with every non-letter taken out (see expo-modules-autolinking).
  s.module_name    = 'home_widget'
  s.source_files   = 'ios/**/*.{h,m,mm,swift}'
  s.preserve_paths = 'ios/**/*'
  s.swift_version  = '5.0'
  s.frameworks     = 'WidgetKit', 'SwiftUI'
  s.dependency 'ExpoModulesCore'
end
