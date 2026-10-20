// The view is read straight from the native module ("CoverClip") in
// `src/components/AnimatedArtworkView.tsx`, which falls back to a still cover
// where the build has no such module (Expo Go, Android).
// This file only exists so expo-modules-autolinking picks the local module up.
export {};
