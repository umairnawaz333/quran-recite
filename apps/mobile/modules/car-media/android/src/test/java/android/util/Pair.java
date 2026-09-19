package android.util;

import java.util.Objects;

/**
 * The real `android.util.Pair`, shadowing android.jar's stub on the unit-test
 * classpath — same trick as `org.json:json` in this module's build.gradle, and
 * for the same reason: `unitTests.returnDefaultValues` makes the stub hand back
 * `null`, and media3's `Timeline.getPeriodPositionUs` (reached whenever
 * `SimpleBasePlayer` recomputes its state) immediately `checkNotNull`s it.
 *
 * Copied from AOSP's implementation, which is this small on purpose.
 */
public class Pair<F, S> {
  public final F first;
  public final S second;

  public Pair(F first, S second) {
    this.first = first;
    this.second = second;
  }

  public static <A, B> Pair<A, B> create(A a, B b) {
    return new Pair<>(a, b);
  }

  @Override
  public boolean equals(Object o) {
    if (!(o instanceof Pair)) {
      return false;
    }
    Pair<?, ?> other = (Pair<?, ?>) o;
    return Objects.equals(first, other.first) && Objects.equals(second, other.second);
  }

  @Override
  public int hashCode() {
    return (first == null ? 0 : first.hashCode()) ^ (second == null ? 0 : second.hashCode());
  }

  @Override
  public String toString() {
    return "Pair{" + first + " " + second + "}";
  }
}
