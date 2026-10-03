#!/usr/bin/env bash
# Checks the extractors patched into expo-audio on the JVM, without an APK.
#
#   pnpm harness:extractor
#
# Compiles the patched FragmentSeekingExtractor.kt from node_modules and runs
# Harness.java over an ffmpeg corpus, one file per kind that has broken
# before. Needs JDK 17, ffmpeg and android.jar; jars come from Maven once.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
HERE="$ROOT/scripts/native-harness"
WORK="$ROOT/node_modules/.cache/native-harness"
SDK=${ANDROID_HOME:-$HOME/Android/Sdk}
AUDIO="$ROOT/node_modules/expo-audio/android"
KT_SRC="${KT_SRC:-$AUDIO/src/main/java/expo/modules/audio/FragmentSeekingExtractor.kt}"
MEDIA3=${MEDIA3:-$(sed -n 's/.*androidxMedia3Version = "\(.*\)".*/\1/p' "$AUDIO/build.gradle")}
KOTLIN=${KOTLIN:-2.1.20}

GOOGLE=https://dl.google.com/dl/android/maven2
CENTRAL=https://repo1.maven.org/maven2

mkdir -p "$WORK/m2" "$WORK/corpus"
cd "$WORK"

# fetch REPO GROUP ARTIFACT VERSION EXT: prints the jar, downloading it once.
# From an .aar only classes.jar is kept.
fetch() {
  local jar="m2/$3-$4.jar"
  if [ ! -f "$jar" ]; then
    local url="$1/${2//.//}/$3/$4/$3-$4.$5"
    curl -fsSL "$url" -o "$jar.tmp" || { echo "could not download $url" >&2; exit 2; }
    if [ "$5" = aar ]; then unzip -p "$jar.tmp" classes.jar > "$jar" && rm "$jar.tmp"; else mv "$jar.tmp" "$jar"; fi
  fi
  echo "$WORK/$jar"
}

LIB=""
for m in common container extractor; do LIB="$LIB:$(fetch $GOOGLE androidx.media3 media3-$m "$MEDIA3" aar)"; done
LIB="$LIB:$(fetch $GOOGLE androidx.annotation annotation-jvm 1.9.1 jar)"
LIB="$LIB:$(fetch $CENTRAL com.google.guava guava 33.3.1-android jar)"
LIB="$LIB:$(fetch $CENTRAL com.google.guava failureaccess 1.0.2 jar)"
LIB="$LIB:$(fetch $CENTRAL org.jetbrains annotations 23.0.0 jar)"
STDLIB=$(fetch $CENTRAL org.jetbrains.kotlin kotlin-stdlib "$KOTLIN" jar)

KCP=""
for a in kotlin-compiler-embeddable kotlin-stdlib kotlin-script-runtime kotlin-reflect kotlin-daemon-embeddable; do
  KCP="$KCP:$(fetch $CENTRAL org.jetbrains.kotlin $a "$KOTLIN" jar)"
done
KCP="$KCP:$(fetch $CENTRAL org.jetbrains.intellij.deps trove4j 1.0.20200330 jar)"
KCP="$KCP:$(fetch $CENTRAL org.jetbrains.kotlinx kotlinx-coroutines-core-jvm 1.8.0 jar)"
KCP="$KCP:$(fetch $CENTRAL org.jetbrains annotations 23.0.0 jar)"

ANDROID_JAR=$(ls -d "$SDK"/platforms/android-*/android.jar 2>/dev/null | sort -V | tail -1)
[ -n "$ANDROID_JAR" ] || { echo "no android.jar under $SDK/platforms" >&2; exit 2; }
# The shims go before android.jar, whose classes only throw "Stub!".
CP="$WORK/shim:${LIB#:}:$STDLIB:$ANDROID_JAR"

rm -rf shim out && mkdir -p shim out
javac -nowarn -d shim -cp "$ANDROID_JAR" "$HERE"/shim/android/*/*.java
java -cp "${KCP#:}" org.jetbrains.kotlin.cli.jvm.K2JVMCompiler -no-stdlib -no-reflect -jvm-target 17 \
  -cp "$CP" -d out "$KT_SRC" 2>&1 | grep -v '^warning' || true
[ -f out/expo/modules/audio/FragmentSeekingExtractor.class ] || { echo "the extractor did not compile" >&2; exit 1; }
javac -nowarn -d out -cp "out:$CP" "$HERE/Harness.java"

# 120 s each, which the harness relies on. `pipe` writes like a server
# transcoding on the fly: no index, no header filled in afterwards.
cd corpus
src=(-f lavfi -i "anoisesrc=d=120:a=0.1:seed=1")
make() { [ -f "$1" ] || ffmpeg -v error -y "${src[@]}" "${@:2}" "$1"; }
pipe() { [ -f "$1" ] || ffmpeg -v error -y "${src[@]}" "${@:2}" - > "$1"; }
frag=(-movflags frag_keyframe+empty_moov)

# Fragmented, no `sidx`: the files media3 will not seek on its own (#242).
make frag-aac-2s.m4a -c:a aac -b:a 192k "${frag[@]}" -frag_duration 2000000
make frag-alac-2s.m4a -c:a alac "${frag[@]}" -frag_duration 2000000
make frag-aac-10s.m4a -c:a aac -b:a 64k "${frag[@]}" -frag_duration 10000000
make frag-aac-small.m4a -c:a aac -b:a 32k "${frag[@]}" -frag_duration 500000
# Must keep working whatever the patch does.
make plain-aac.m4a -c:a aac -b:a 192k -movflags +faststart
make flac-24bit.flac -c:a flac -sample_fmt s32 -ar 96000
make mp3-vbr-xing.mp3 -c:a libmp3lame -q:a 2
make opus.ogg -c:a libopus -b:a 128k
# Downloads transcoded by the server (#123, #136).
pipe piped-aac.aac -c:a aac -b:a 192k -f adts
pipe piped-mp3-cbr.mp3 -c:a libmp3lame -b:a 192k -f mp3

java -cp "$WORK/out:$CP" Harness \
  frag-aac-2s.m4a frag-alac-2s.m4a frag-aac-10s.m4a frag-aac-small.m4a \
  plain-aac.m4a flac-24bit.flac mp3-vbr-xing.mp3 opus.ogg \
  piped-aac.aac piped-mp3-cbr.mp3
