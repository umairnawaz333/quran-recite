export interface CacheEntry {
  url: string;
  size: number;
  lastUsed: number;
}

/** Runtime cache budget. Pinned downloads are exempt from this. */
export const RUNTIME_BUDGET_BYTES = 100 * 1024 * 1024;

/**
 * Chooses which cached audio files to drop so the runtime cache fits its
 * budget, least-recently-used first.
 *
 * Pure by design: this is the part that has to be right, and keeping it free
 * of Cache Storage and IndexedDB means it can be tested exhaustively without
 * a browser.
 */
export function selectEvictions(entries: CacheEntry[], budgetBytes: number): string[] {
  const total = entries.reduce((sum, entry) => sum + entry.size, 0);
  if (total <= budgetBytes) return [];

  // Oldest first; url breaks ties so the result is deterministic.
  const ordered = [...entries].sort(
    (a, b) => a.lastUsed - b.lastUsed || a.url.localeCompare(b.url),
  );

  const victims: string[] = [];
  let remaining = total;
  for (const entry of ordered) {
    if (remaining <= budgetBytes) break;
    victims.push(entry.url);
    remaining -= entry.size;
  }
  return victims;
}
