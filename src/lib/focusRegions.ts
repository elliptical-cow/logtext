export type FocusRegionId = "left" | "middle" | "right";

const regionOrder: FocusRegionId[] = ["left", "middle", "right"];
const regionRoots = new Map<FocusRegionId, HTMLElement>();
const lastFocused = new Map<FocusRegionId, HTMLElement>();

const ENTRY_SELECTORS = [
  "[data-focus-entry]",
  "[role='treeitem'][tabindex='0']",
  ".cm-content[contenteditable='true']",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex='0']",
];

export function focusRegion(node: HTMLElement, id: FocusRegionId) {
  regionRoots.set(id, node);
  node.dataset.focusRegion = id;

  const handleFocusIn = (event: FocusEvent) => {
    if (event.target instanceof HTMLElement) {
      lastFocused.set(id, event.target);
    }
  };
  node.addEventListener("focusin", handleFocusIn);

  return {
    update(nextId: FocusRegionId) {
      if (regionRoots.get(id) === node) {
        regionRoots.delete(id);
      }
      id = nextId;
      regionRoots.set(id, node);
      node.dataset.focusRegion = id;
    },
    destroy() {
      node.removeEventListener("focusin", handleFocusIn);
      if (regionRoots.get(id) === node) {
        regionRoots.delete(id);
      }
      if (lastFocused.get(id) && !lastFocused.get(id)?.isConnected) {
        lastFocused.delete(id);
      }
    },
  };
}

export function activeFocusRegion() {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) {
    return null;
  }

  for (const id of regionOrder) {
    if (regionRoots.get(id)?.contains(active)) {
      return id;
    }
  }
  return null;
}

export function focusWorkspaceRegion(id: FocusRegionId) {
  const root = regionRoots.get(id);
  if (!root || !isVisible(root)) {
    return false;
  }

  const previous = lastFocused.get(id);
  const entry = ENTRY_SELECTORS
    .map((selector) => root.querySelector<HTMLElement>(selector))
    .find((candidate): candidate is HTMLElement => Boolean(candidate));
  const target = previous?.isConnected && root.contains(previous) && isVisible(previous)
    ? previous
    : entry ?? root;
  target.focus({ preventScroll: true });
  return true;
}

export function cycleFocusRegion(direction: 1 | -1) {
  const visibleRegions = regionOrder.filter((id) => {
    const root = regionRoots.get(id);
    return root ? isVisible(root) : false;
  });
  if (visibleRegions.length === 0) {
    return false;
  }

  const target = nextFocusRegion(activeFocusRegion(), visibleRegions, direction);
  return target ? focusWorkspaceRegion(target) : false;
}

export function nextFocusRegion(
  current: FocusRegionId | null,
  visibleRegions: readonly FocusRegionId[],
  direction: 1 | -1,
) {
  if (visibleRegions.length === 0) return null;
  const currentIndex = current ? visibleRegions.indexOf(current) : -1;
  const nextIndex = currentIndex < 0
    ? direction > 0 ? 0 : visibleRegions.length - 1
    : (currentIndex + direction + visibleRegions.length) % visibleRegions.length;
  return visibleRegions[nextIndex] ?? null;
}

function isVisible(element: HTMLElement) {
  return !element.hidden && element.getClientRects().length > 0;
}
