import androidx.media3.common.*;
import androidx.media3.common.util.ParsableByteArray;
import androidx.media3.extractor.*;
import androidx.media3.extractor.mp4.FragmentedMp4Extractor;
import androidx.media3.extractor.text.SubtitleParser;
import expo.modules.audio.FragmentSeekingExtractor;
import java.io.*;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;

/**
 * Drives FragmentSeekingExtractor the way ProgressiveMediaPeriod.ExtractingLoadable
 * does (a fresh input on every RESULT_SEEK) and checks it against media3's own
 * FragmentedMp4Extractor: every sample from the top must match, and a seek must
 * land near the second asked for with the rest matching from there. Exits 1 on
 * any difference.
 */
public class Harness {
  static class Rec implements TrackOutput {
    final List<String> samples = new ArrayList<>();
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
      samples.add(t + " " + size + " " + Arrays.hashCode(s));
    }
  }
  static class Out implements ExtractorOutput {
    Rec rec = new Rec(); SeekMap map;
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

  /** Reads from `startUs` (0 = from the top, else seek once the map is in) to the end. */
  static Out run(byte[] file, Extractor ex, long startUs) throws Exception {
    Out out = new Out(); ex.init(out);
    PositionHolder h = new PositionHolder();
    long pos = 0; boolean seekPending = false; int opens = 0;
    while (true) {
      if (++opens > 500) throw new IllegalStateException("too many reopens");
      ExtractorInput in = new DefaultExtractorInput(new Reader(file, pos), pos, file.length);
      if (seekPending) { ex.seek(pos, startUs); seekPending = false; }
      int r = Extractor.RESULT_CONTINUE;
      while (r == Extractor.RESULT_CONTINUE) {
        r = ex.read(in, h);
        // ProgressiveMediaPeriod seeks as soon as it is prepared at a non-zero start.
        if (startUs > 0 && out.map != null && out.rec.samples.isEmpty() == false && !seekDone) {
          seekDone = true; out.rec.samples.clear();
          if (!out.map.isSeekable()) throw new IllegalStateException("unseekable");
          pos = out.map.getSeekPoints(startUs).first.position; seekPending = true; r = -99; break;
        }
      }
      if (r == -99) continue;
      if (r == Extractor.RESULT_SEEK) { pos = h.position; continue; }
      return out;
    }
  }
  static boolean seekDone;

  static boolean failed;

  public static void main(String[] args) throws Exception {
    for (String a : args) check(a);
    System.exit(failed ? 1 : 0);
  }

  static void check(String path) throws Exception {
    String[] a = {path};
    byte[] file = Files.readAllBytes(Paths.get(a[0]));
    seekDone = false;
    Out ref = run(file, new FragmentedMp4Extractor(SubtitleParser.Factory.UNSUPPORTED), 0);
    seekDone = false;
    Out ours = run(file, new FragmentSeekingExtractor(new FragmentedMp4Extractor(SubtitleParser.Factory.UNSUPPORTED)), 0);
    System.out.println(a[0] + ": ref " + ref.rec.samples.size() + " samples, map " + ref.map.getClass().getSimpleName()
        + "; ours " + ours.rec.samples.size() + " samples, map " + ours.map.getClass().getSimpleName() + " " + ours.map.getDurationUs() / 1000 + " ms");
    int firstDiff = -1;
    for (int i = 0; i < Math.max(ref.rec.samples.size(), ours.rec.samples.size()); i++) {
      String x = i < ref.rec.samples.size() ? ref.rec.samples.get(i) : null, y = i < ours.rec.samples.size() ? ours.rec.samples.get(i) : null;
      if (!Objects.equals(x, y)) { firstDiff = i; break; }
    }
    if (firstDiff < 0) System.out.println("  from 0: IDENTICAL");
    else {
      long bad = 0; for (int i = 0; i < Math.min(ref.rec.samples.size(), ours.rec.samples.size()); i++) if (!ref.rec.samples.get(i).equals(ours.rec.samples.get(i))) bad++;
      failed = true;
      System.out.println("  FAIL from 0: first difference at sample " + firstDiff + " (ref " + (firstDiff < ref.rec.samples.size() ? ref.rec.samples.get(firstDiff) : "-") + ", ours " + (firstDiff < ours.rec.samples.size() ? ours.rec.samples.get(firstDiff) : "-") + "), " + bad + " differ");
    }
    for (long s : new long[] {30, 95}) {
      seekDone = false;
      Out sk = run(file, new FragmentSeekingExtractor(new FragmentedMp4Extractor(SubtitleParser.Factory.UNSUPPORTED)), s * 1_000_000L);
      String first = sk.rec.samples.isEmpty() ? "none" : sk.rec.samples.get(0);
      long t = Long.parseLong(first.split(" ")[0]);
      int idx = ref.rec.samples.indexOf(first);
      boolean tailOk = idx >= 0 && ref.rec.samples.subList(idx, ref.rec.samples.size()).equals(sk.rec.samples);
      boolean near = Math.abs(t - s * 1_000_000L) < 1_000_000L;
      if (!tailOk || !near) failed = true;
      System.out.println("  " + (tailOk && near ? "" : "FAIL ") + "seek " + s + " s: lands at " + t / 1000 + " ms, rest matches reference: " + tailOk);
    }
  }
}
