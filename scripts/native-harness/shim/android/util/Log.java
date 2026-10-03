package android.util;
public final class Log {
  public static int d(String t, String m) { return 0; } public static int d(String t, String m, Throwable e) { return 0; }
  public static int i(String t, String m) { return 0; } public static int i(String t, String m, Throwable e) { return 0; }
  public static int v(String t, String m) { return 0; }
  public static int w(String t, String m) { System.err.println("W/" + t + ": " + m); return 0; } public static int w(String t, String m, Throwable e) { return w(t, m); }
  public static int e(String t, String m) { System.err.println("E/" + t + ": " + m); return 0; } public static int e(String t, String m, Throwable e) { return e(t, m); }
  public static String getStackTraceString(Throwable t) { return String.valueOf(t); }
  public static boolean isLoggable(String t, int l) { return false; }
}
