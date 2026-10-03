package android.net;
/** Just enough for media3 to pick extractors by file extension. */
public class Uri {
  public static final Uri EMPTY = new Uri("");
  private final String s;
  private Uri(String s) { this.s = s; }
  public static Uri parse(String s) { return new Uri(s); }
  public String getPath() { return s; }
  public String getScheme() { return null; }
  public String getLastPathSegment() { int i = s.lastIndexOf('/'); return s.isEmpty() ? null : s.substring(i + 1); }
  @Override public String toString() { return s; }
}
