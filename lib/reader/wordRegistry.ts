const ACTIVE = 'word--active';
const ACTIVE_ESTIMATED = 'word--active-estimated';

/**
 * Maps word ids to their DOM nodes so the sync engine can move the highlight
 * without re-rendering React. Exactly two nodes are touched per change.
 */
export class WordRegistry {
  private nodes = new Map<string, HTMLElement>();
  private activeId: string | null = null;

  register(id: string, el: HTMLElement | null): void {
    if (el) this.nodes.set(id, el);
    else this.nodes.delete(id);
  }

  setActive(id: string | null, estimated: boolean): void {
    if (id === this.activeId) return;

    const previous = this.activeId ? this.nodes.get(this.activeId) : undefined;
    previous?.classList.remove(ACTIVE, ACTIVE_ESTIMATED);

    const next = id ? this.nodes.get(id) : undefined;
    if (next) {
      next.classList.add(ACTIVE);
      if (estimated) next.classList.add(ACTIVE_ESTIMATED);
    }

    this.activeId = id;
  }

  getNode(id: string): HTMLElement | undefined {
    return this.nodes.get(id);
  }

  clear(): void {
    this.setActive(null, false);
    this.nodes.clear();
  }
}
