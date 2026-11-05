# ALAC decoder

This Android-only module adds Media3's FFmpeg audio renderer to Resonus. The
extension renderer is registered after the platform renderers, and the native
library contains the `alac` decoder only. Devices with a working platform ALAC
decoder still use it; FFmpeg is used only when the platform cannot handle an
ALAC stream. Every other audio format continues to use the device decoder
selected by `expo-audio`.

Source provenance:

- Media3 decoder sources: [`androidx/media` 1.9.0][media3-source], commit
  `7cc1056f840ce226598d3b990d4a6f7cd17e2831`. The unfinished video renderer is
  omitted; the included audio sources are otherwise unchanged.
- FFmpeg: [n6.0.1][ffmpeg-source], commit
  `c41ff724ede7da657762d61097e26fac296c53bf`.
- Native targets: `armeabi-v7a`, `arm64-v8a` and `x86_64`, Android API 21,
  NDK 27.1.12297006.
- Enabled FFmpeg decoder: `alac` only.
- `libffmpegJNI.so` SHA-256:
  - `armeabi-v7a`:
    `a2ea8ad4a2975f6567d9af1b8e7e66bbb64f3d35d7088260a1f3e983f15fcb48`
  - `arm64-v8a`:
    `30f625082d650287145612a7d2afb7f7354680935012dcf117f73891f05caa12`
  - `x86_64`:
    `d8dfe6ff879a310b37c856606e5c0661e05856d9903a90da685869699c78e48d`

The libraries are built by
[`scripts/build-alac-ffmpeg.sh`](../../scripts/build-alac-ffmpeg.sh), which
fetches both sources at the commits above and runs Media3's own
`build_ffmpeg.sh` (`--disable-everything`, `--enable-swresample` and
`--enable-decoder=alac`) and its own `CMakeLists.txt`, unchanged. The JNI
libraries are stripped and use 16 KB ELF load-segment alignment. The F-Droid
build deletes the copies in this folder and runs the same script.

The Java renderer sources retain their upstream Apache-2.0 headers. FFmpeg's
license for this configuration is LGPL-2.1-or-later; its license text is in
[`LICENSE.LGPL-2.1`](LICENSE.LGPL-2.1).

[media3-source]: https://github.com/androidx/media/tree/7cc1056f840ce226598d3b990d4a6f7cd17e2831/libraries/decoder_ffmpeg
[ffmpeg-source]: https://github.com/FFmpeg/FFmpeg/tree/c41ff724ede7da657762d61097e26fac296c53bf
