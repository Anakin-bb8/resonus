import android.net.Uri;
import androidx.media3.common.*;
import androidx.media3.common.util.ParsableByteArray;
import androidx.media3.extractor.*;
import androidx.media3.extractor.mp4.FragmentedMp4Extractor;
import androidx.media3.extractor.text.SubtitleParser;
import expo.modules.audio.FragmentSeekingExtractor;
import expo.modules.audio.FragmentSeekingExtractorKt;
import java.io.*;
import java.nio.file.*;
import java.util.*;

/**
 * Plays each file through the extractors the app plays with (`seekableExtractors()`),
 * picked by sniffing the way BundledExtractorsAdapter does and driven the way
 * ProgressiveMediaPeriod.ExtractingLoadable does (a fresh input on every
 * RESULT_SEEK). Every file is 120 s long, and for each one it checks that:
 *
 * - it plays to the end from the top (0.7.12 stopped fMP4s two seconds in),
 * - it has a seek map with the right duration,
 * - a seek to 30 s and to 95 s lands within a second, at the right time, and
 *   carries on with exactly the samples a read from the top gets there.
 *
 * A fragmented MP4 is also compared sample by sample against media3's own
 * FragmentedMp4Extractor. Exits 1 on any failure.
 */
public class Harness {
  static final long LENGTH_US = 120_000_000L;
  static final long SECOND = 1_000_000L;

  /** One sample: when it plays, and what it is (size and hash of its bytes). */
  record Sample(long timeUs, String key) {}

  static class Rec implements TrackOutput {
    final List<Sample> samples = new ArrayList<>();
    ByteArrayOutputStream cur = new ByteArrayOutputStream();
    public void format(Format f) {}
    public int sampleData(DataReader in, int len, boolean allowEnd, int part) throws IOException {
      byte[] b = new byte[len]; int n = in.read(b, 0, len);
      if (n == C.RESULT_END_OF_INPUT) { if (allowEnd) return n; throw new EOFException(); }
      cur.write(b, 0, n); return n;
    }
    public void sampleData(ParsableByteArray d, int len, int part) { byte[] b = new byte[len]; d.readBytes(b, 0, len); cur.write(b, 0, len); }
    public void sampleMetadata(long t, int flags, int size, int offset, CryptoData c) {
      byte[] all = cur.toByteArray();
      byte[] s = Arrays.copyOfRange(all, all.length - offset - size, all.length - offset);
      cur = new ByteArrayOutputStream(); cur.write(all, all.length - offset, offset);
      samples.add(new Sample(t, size + " " + Arrays.hashCode(s)));
    }
  }

  static class Out implements ExtractorOutput {
    final Rec rec = new Rec(); SeekMap map;
    public TrackOutput track(int id, int type) { return rec; }
    public void endTracks() {}
    public void seekMap(SeekMap m) { map = m; }
  }

  static class Reader implements DataReader {
    final byte[] d; int p;
    Reader(byte[] d, long p) { this.d = d; this.p = (int) p; }
    public int read(byte[] b, int off, int len) {
      if (p >= d.length) return C.RESULT_END_OF_INPUT;
      int n = Math.min(len, Math.min(d.length - p, 4096)); System.arraycopy(d, p, b, off, n); p += n; return n;
    }
  }

  static ExtractorInput input(byte[] file, long pos) {
    return new DefaultExtractorInput(new Reader(file, pos), pos, file.length);
  }

  /** An extractor that recognised the file, and where its sniff left the input. */
  record Picked(Extractor ex, long pos) {}

  /**
   * The first of the app's extractors that recognises the file, as ExoPlayer
   * picks it. A sniff that says yes may move the input on (Mp3Extractor skips
   * the ID3 tag), and ExoPlayer reads on from there, so the harness does too.
   */
  static Picked pick(String path, byte[] file) throws IOException {
    for (Extractor e : FragmentSeekingExtractorKt.seekableExtractors().createExtractors(Uri.parse(path), Map.of())) {
      ExtractorInput in = input(file, 0);
      boolean yes;
      try { yes = e.sniff(in); } catch (EOFException x) { yes = false; }
      if (yes) return new Picked(e, in.getPosition());
    }
    throw new IllegalStateException("no extractor recognises it");
  }

  /** Reads from `startUs` (0 = from the top, else seek once prepared) to the end. */
  static Out run(byte[] file, Extractor ex, long from, long startUs) throws Exception {
    Out out = new Out(); ex.init(out);
    PositionHolder h = new PositionHolder();
    long pos = from; boolean seekPending = false, seekDone = startUs == 0; int opens = 0;
    while (true) {
      if (++opens > 500) throw new IllegalStateException("too many reopens");
      ExtractorInput in = input(file, pos);
      if (seekPending) { ex.seek(pos, startUs); seekPending = false; }
      int r = Extractor.RESULT_CONTINUE;
      boolean reopen = false;
      while (r == Extractor.RESULT_CONTINUE) {
        r = ex.read(in, h);
        // ProgressiveMediaPeriod seeks as soon as it is prepared at a non-zero start.
        if (!seekDone && out.map != null && !out.rec.samples.isEmpty()) {
          seekDone = true; out.rec.samples.clear();
          if (!out.map.isSeekable()) throw new IllegalStateException("unseekable");
          pos = out.map.getSeekPoints(startUs).first.position; seekPending = true; reopen = true; break;
        }
      }
      if (reopen) continue;
      if (r == Extractor.RESULT_SEEK) { pos = h.position; continue; }
      return out;
    }
  }

  static boolean failed;

  static void report(boolean ok, String what) {
    if (!ok) failed = true;
    System.out.println("  " + (ok ? "ok   " : "FAIL ") + what);
  }

  public static void main(String[] args) throws Exception {
    for (String a : args) {
      try { check(a); } catch (Exception e) { System.out.println(a + "\n  FAIL " + e); failed = true; }
    }
    System.exit(failed ? 1 : 0);
  }

  static void check(String path) throws Exception {
    byte[] file = Files.readAllBytes(Paths.get(path));
    Picked p = pick(path, file);
    Extractor ex = p.ex();
    System.out.println(path + " (" + ex.getClass().getSimpleName() + ")");
    Out top = run(file, ex, p.pos(), 0);
    List<Sample> ref = top.rec.samples;

    long last = ref.isEmpty() ? 0 : ref.get(ref.size() - 1).timeUs();
    report(LENGTH_US - last < SECOND, "plays to the end: last sample at " + last / 1000 + " ms");

    long dur = top.map == null ? C.TIME_UNSET : top.map.getDurationUs();
    report(top.map != null && top.map.isSeekable() && dur != C.TIME_UNSET && Math.abs(dur - LENGTH_US) < 2 * SECOND,
        "seekable, duration " + (dur == C.TIME_UNSET ? "unknown" : dur / 1000 + " ms")
            + (top.map == null ? "" : " (" + top.map.getClass().getSimpleName() + ")"));

    if (ex instanceof FragmentSeekingExtractor) {
      List<Sample> media3 = run(file, new FragmentedMp4Extractor(SubtitleParser.Factory.UNSUPPORTED), 0, 0).rec.samples;
      int diff = 0; while (diff < Math.min(media3.size(), ref.size()) && media3.get(diff).equals(ref.get(diff))) diff++;
      report(diff == media3.size() && diff == ref.size(), "same samples as media3 alone"
          + (diff == media3.size() && diff == ref.size() ? "" : ": first difference at sample " + diff));
    }

    for (long s : new long[] {30, 95}) {
      Picked q = pick(path, file);
      List<Sample> sk = run(file, q.ex(), q.pos(), s * SECOND).rec.samples;
      if (sk.isEmpty()) { report(false, "seek " + s + " s: no samples after it"); continue; }
      Sample first = sk.get(0);
      int idx = -1;
      for (int i = 0; i < ref.size() && idx < 0; i++) if (ref.get(i).key().equals(first.key())) idx = i;
      boolean tail = idx >= 0 && keys(ref.subList(idx, ref.size())).equals(keys(sk));
      long drift = idx >= 0 ? first.timeUs() - ref.get(idx).timeUs() : 0;
      boolean near = Math.abs(first.timeUs() - s * SECOND) < SECOND;
      report(tail && near && Math.abs(drift) < SECOND / 5, "seek " + s + " s: lands at " + first.timeUs() / 1000 + " ms"
          + (idx < 0 ? ", on a sample a read from the top never gets" : ", clock off by " + drift / 1000 + " ms, rest matches: " + tail));
    }
  }

  static List<String> keys(List<Sample> l) { return l.stream().map(Sample::key).toList(); }
}
