package android.util;

import java.util.Map;
import java.util.TreeMap;

/**
 * A working `android.util.SparseBooleanArray` for the unit-test classpath,
 * shadowing android.jar's stub — same trick as `org.json:json` in this module's
 * build.gradle. media3 stores every `Player.Commands` flag in one of these
 * (through `FlagSet`), so with the stub's default `false` a player advertises
 * NO commands at all and `SimpleBasePlayer` silently drops every call.
 *
 * Backed by a sorted map rather than AOSP's packed arrays: same observable
 * behaviour (`keyAt` walks the keys in ascending order), a fraction of the code.
 */
public class SparseBooleanArray {
  private final TreeMap<Integer, Boolean> values = new TreeMap<>();

  public SparseBooleanArray() {}

  public SparseBooleanArray(int initialCapacity) {}

  public boolean get(int key) {
    return get(key, false);
  }

  public boolean get(int key, boolean valueIfKeyNotFound) {
    Boolean value = values.get(key);
    return value == null ? valueIfKeyNotFound : value;
  }

  public void put(int key, boolean value) {
    values.put(key, value);
  }

  public void append(int key, boolean value) {
    values.put(key, value);
  }

  public void delete(int key) {
    values.remove(key);
  }

  public void clear() {
    values.clear();
  }

  public int size() {
    return values.size();
  }

  public int keyAt(int index) {
    return entryAt(index).getKey();
  }

  public boolean valueAt(int index) {
    return entryAt(index).getValue();
  }

  public int indexOfKey(int key) {
    int index = 0;
    for (Integer candidate : values.keySet()) {
      if (candidate == key) {
        return index;
      }
      index++;
    }
    return -1;
  }

  private Map.Entry<Integer, Boolean> entryAt(int index) {
    int i = 0;
    for (Map.Entry<Integer, Boolean> entry : values.entrySet()) {
      if (i++ == index) {
        return entry;
      }
    }
    throw new ArrayIndexOutOfBoundsException(index);
  }

  @Override
  public boolean equals(Object o) {
    return o instanceof SparseBooleanArray && values.equals(((SparseBooleanArray) o).values);
  }

  @Override
  public int hashCode() {
    return values.hashCode();
  }

  @Override
  public String toString() {
    return values.toString();
  }
}
