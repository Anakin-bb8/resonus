#!/usr/bin/env bash
#
# Builds modules/alac-decoder's libffmpegJNI.so from source: FFmpeg with the
# `alac` decoder only, and Media3's JNI glue around it, both at the commits
# the module's README names.
#
#   scripts/build-alac-ffmpeg.sh [ABI...]
#
# ABIs default to armeabi-v7a, arm64-v8a and x86_64. The NDK is
# $ANDROID_NDK_HOME, or the newest one under $ANDROID_HOME/ndk. The sources
# are cloned into a temporary folder unless FFMPEG_DIR (an FFmpeg checkout)
# and MEDIA3_DIR (an androidx/media checkout) point at ones already there,
# which is how the F-Droid build hands them over. The libraries land in
# modules/alac-decoder/android/src/main/jniLibs/<ABI>/.
#
# The FFmpeg half is Media3's own build_ffmpeg.sh, unchanged, and the JNI
# half its own CMakeLists.txt, so what is built is what Media3 builds with
# the decoder list cut down to one.
set -euo pipefail

FFMPEG_COMMIT=c41ff724ede7da657762d61097e26fac296c53bf # n6.0.1
MEDIA3_COMMIT=7cc1056f840ce226598d3b990d4a6f7cd17e2831 # 1.9.0
API=21

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/modules/alac-decoder/android/src/main/jniLibs"
ABIS=("$@")
[[ ${#ABIS[@]} -eq 0 ]] && ABIS=(armeabi-v7a arm64-v8a x86_64)

NDK="${ANDROID_NDK_HOME:-}"
if [[ -z "$NDK" ]]; then
  NDK="$(ls -d "${ANDROID_HOME:?Set ANDROID_HOME or ANDROID_NDK_HOME}"/ndk/* | sort -V | tail -1)"
fi
HOST="$(uname -s | tr '[:upper:]' '[:lower:]')-x86_64"
# The SDK's own CMake ships with Ninja; a system CMake may come without it.
if ! command -v ninja >/dev/null && [[ -n "${ANDROID_HOME:-}" ]]; then
  PATH="$(ls -d "$ANDROID_HOME"/cmake/*/bin | sort -V | tail -1):$PATH"
fi
echo "NDK: $NDK"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

checkout() { # <dir> <url> <commit>
  git -C "$1" init -q
  git -C "$1" fetch -q --depth 1 "$2" "$3"
  git -C "$1" checkout -q FETCH_HEAD
}

if [[ -z "${FFMPEG_DIR:-}" ]]; then
  FFMPEG_DIR="$WORK/ffmpeg-src"
  mkdir -p "$FFMPEG_DIR"
  checkout "$FFMPEG_DIR" https://github.com/FFmpeg/FFmpeg.git "$FFMPEG_COMMIT"
fi
if [[ -z "${MEDIA3_DIR:-}" ]]; then
  MEDIA3_DIR="$WORK/media3-src"
  mkdir -p "$MEDIA3_DIR"
  git -C "$MEDIA3_DIR" init -q
  git -C "$MEDIA3_DIR" sparse-checkout set libraries/decoder_ffmpeg/src/main/jni
  git -C "$MEDIA3_DIR" fetch -q --depth 1 --filter=blob:none https://github.com/androidx/media.git "$MEDIA3_COMMIT"
  git -C "$MEDIA3_DIR" checkout -q FETCH_HEAD
fi

# Media3's layout: the JNI sources, with FFmpeg as `ffmpeg` beside them.
MODULE="$WORK/decoder_ffmpeg"
mkdir -p "$MODULE"
cp -r "$MEDIA3_DIR/libraries/decoder_ffmpeg/src/main/jni" "$MODULE/jni"
rm -rf "$MODULE/jni/ffmpeg"
cp -r "$FFMPEG_DIR" "$MODULE/jni/ffmpeg"

bash "$MODULE/jni/build_ffmpeg.sh" "$MODULE" "$NDK" "$HOST" "$API" alac

for abi in "${ABIS[@]}"; do
  build="$WORK/cmake-$abi"
  cmake -S "$MODULE/jni" -B "$build" -G Ninja \
    -DCMAKE_TOOLCHAIN_FILE="$NDK/build/cmake/android.toolchain.cmake" \
    -DANDROID_ABI="$abi" \
    -DANDROID_PLATFORM="android-$API" \
    -DCMAKE_BUILD_TYPE=Release >/dev/null
  cmake --build "$build"
  mkdir -p "$OUT/$abi"
  "$NDK/toolchains/llvm/prebuilt/$HOST/bin/llvm-strip" --strip-unneeded \
    -o "$OUT/$abi/libffmpegJNI.so" "$build/libffmpegJNI.so"
  echo "$abi: $(sha256sum "$OUT/$abi/libffmpegJNI.so" | cut -d' ' -f1)"
done
