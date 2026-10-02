package android.util;
import java.util.TreeMap;
public class SparseArray<E> implements Cloneable {
  private TreeMap<Integer,E> m = new TreeMap<>();
  public SparseArray() {} public SparseArray(int c) {}
  public E get(int k) { return m.get(k); } public E get(int k, E d) { E v = m.get(k); return v == null ? d : v; }
  public void put(int k, E v) { m.put(k, v); } public void append(int k, E v) { m.put(k, v); }
  public void remove(int k) { m.remove(k); } public void delete(int k) { m.remove(k); }
  public int size() { return m.size(); } public void clear() { m.clear(); }
  public int keyAt(int i) { return (Integer) m.keySet().toArray()[i]; }
  @SuppressWarnings("unchecked") public E valueAt(int i) { return (E) m.values().toArray()[i]; }
  public int indexOfKey(int k) { int i = 0; for (Integer x : m.keySet()) { if (x == k) return i; i++; } return -1; }
  public boolean contains(int k) { return m.containsKey(k); }
}
