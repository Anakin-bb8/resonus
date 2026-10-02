#!/usr/bin/env bash
# Checks the extractors patched into expo-audio on the JVM, without an APK.
#
#   pnpm harness:extractor
#
# Compiles FragmentSeekingExtractor.kt as installed in node_modules (so with
# the patch applied, i.e. what ships) against the media3 jars Gradle already
# downloaded, and runs Harness.java over fragmented M4A files made with ffmpeg.
# Needs one Android build done before (for the Gradle cache), a JDK and ffmpeg.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
HERE="$ROOT/scripts/native-harness"
WORK="$ROOT/node_modules/.cache/native-harness"
G="$HOME/.gradle/caches/modules-2/files-2.1"
MEDIA3=${MEDIA3:-1.9.0}
SDK=${ANDROID_HOME:-$HOME/Android/Sdk}
KT_SRC="${KT_SRC:-$ROOT/node_modules/expo-audio/android/src/main/java/expo/modules/audio/FragmentSeekingExtractor.kt}"

newest() { find "$G/$1" -name "$2" ! -name '*sources*' 2>/dev/null | sort -V | tail -1; }

mkdir -p "$WORK/lib"
cd "$WORK"

for m in common container extractor; do
  [ -f "lib/media3-$m.jar" ] && continue
  aar=$(newest "androidx.media3/media3-$m/$MEDIA3" "*.aar")
  [ -n "$aar" ] || { echo "media3-$m $MEDIA3 is not in the Gradle cache: build the app once" >&2; exit 2; }
  unzip -qo "$aar" classes.jar -d "tmp-$m" && mv "tmp-$m/classes.jar" "lib/media3-$m.jar" && rm -rf "tmp-$m"
done
for j in com.google.guava/guava:guava-*.jar com.google.guava/failureaccess:failureaccess-*.jar \
  androidx.annotation/annotation-jvm:annotation-jvm-*.jar org.jetbrains/annotations:annotations-*.jar; do
  f=$(newest "${j%%:*}" "${j#*:}"); [ -n "$f" ] && cp -n "$f" lib/
done

# The compiler and what it runs on, all of one Kotlin version.
KV=$(find "$G/org.jetbrains.kotlin/kotlin-compiler-embeddable" -mindepth 1 -maxdepth 1 -printf '%f\n' | sort -V | tail -1)
KCP=""
for a in kotlin-compiler-embeddable kotlin-stdlib kotlin-script-runtime kotlin-reflect kotlin-daemon-embeddable; do
  f=$(newest "org.jetbrains.kotlin/$a/$KV" "$a-$KV.jar")
  [ -n "$f" ] || { echo "$a $KV missing from the Gradle cache" >&2; exit 2; }
  KCP="$KCP:$f"
done
for j in org.jetbrains.intellij.deps/trove4j:trove4j-*.jar org.jetbrains.kotlinx/kotlinx-coroutines-core-jvm:kotlinx-coroutines-core-jvm-*.jar \
  org.jetbrains/annotations:annotations-*.jar; do
  KCP="$KCP:$(newest "${j%%:*}" "${j#*:}")"
done
STDLIB=$(newest "org.jetbrains.kotlin/kotlin-stdlib/$KV" "kotlin-stdlib-$KV.jar")

ANDROID_JAR=$(ls -d "$SDK"/platforms/android-*/android.jar | sort -V | tail -1)
LIB=$(ls lib/*.jar | tr '\n' ':')
# The shims go before android.jar, whose classes only throw "Stub!".
CP="shim:$LIB$STDLIB:$ANDROID_JAR"

rm -rf shim out && mkdir -p shim out
javac -nowarn -d shim -cp "$ANDROID_JAR" "$HERE"/shim/android/*/*.java
java -cp "${KCP#:}" org.jetbrains.kotlin.cli.jvm.K2JVMCompiler -no-stdlib -no-reflect -jvm-target 17 \
  -cp "$CP" -d out "$KT_SRC" 2>&1 | grep -v '^warning' || true
[ -f out/expo/modules/audio/FragmentSeekingExtractor.class ] || { echo "the extractor did not compile" >&2; exit 1; }
javac -nowarn -d out -cp "out:$CP" "$HERE/Harness.java"

# Fragmented, no `sidx`: the files media3 will not seek on its own (#242).
make() { [ -f "$1" ] || ffmpeg -v error -y "${@:2}" -movflags frag_keyframe+empty_moov "$1"; }
make aac-2s.m4a -f lavfi -i "anoisesrc=d=120:a=0.1" -c:a aac -b:a 192k -frag_duration 2000000
make alac-2s.m4a -f lavfi -i "anoisesrc=d=120:a=0.1" -c:a alac -frag_duration 2000000
make aac-10s.m4a -f lavfi -i "anoisesrc=d=100:a=0.1" -c:a aac -b:a 64k -frag_duration 10000000
make aac-small.m4a -f lavfi -i "anoisesrc=d=100:a=0.1" -c:a aac -b:a 32k -frag_duration 500000

java -cp "out:$CP" Harness aac-2s.m4a alac-2s.m4a aac-10s.m4a aac-small.m4a
