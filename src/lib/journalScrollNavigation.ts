import {
  adjacentJournalPath,
  journalBoundaryDirection,
  type JournalDirection,
} from "./journals.js";

type ScrollContainer = Pick<HTMLElement, "scrollTop" | "scrollHeight" | "clientHeight">;

type JournalScrollContext = {
  currentPath: string | null;
  pagePaths: string[];
  journalFolder: string;
  sortDescending: boolean;
};

type JournalScrollDependencies = {
  openPage: (path: string) => Promise<boolean>;
  afterOpen: () => Promise<unknown>;
  gestureLockMs?: number;
};

export function createJournalScrollNavigation(dependencies: JournalScrollDependencies) {
  let navigationPending = false;
  let gestureLocked = false;
  let destroyed = false;
  let gestureTimer: ReturnType<typeof setTimeout> | null = null;

  async function handleWheel(
    event: WheelEvent,
    container: ScrollContainer,
    context: JournalScrollContext,
  ) {
    if (destroyed || event.ctrlKey || event.metaKey || navigationPending) {
      return false;
    }
    if (gestureLocked) {
      return false;
    }

    const direction = journalBoundaryDirection(
      container.scrollTop,
      container.scrollHeight,
      container.clientHeight,
      event.deltaY,
    );
    if (!direction || !context.currentPath) {
      return false;
    }
    const targetPath = adjacentJournalPath(
      context.currentPath,
      context.pagePaths,
      context.journalFolder,
      direction,
      context.sortDescending ? "desc" : "asc",
    );
    if (!targetPath) {
      return false;
    }

    event.preventDefault();
    gestureLocked = true;
    scheduleGestureUnlock();
    navigationPending = true;
    try {
      const opened = await dependencies.openPage(targetPath);
      if (!opened || destroyed) {
        return false;
      }
      await dependencies.afterOpen();
      if (destroyed) {
        return false;
      }
      scrollToEntryBoundary(container, direction);
      return true;
    } finally {
      navigationPending = false;
    }
  }

  function scheduleGestureUnlock() {
    if (gestureTimer) {
      clearTimeout(gestureTimer);
    }
    gestureTimer = setTimeout(() => {
      gestureLocked = false;
      gestureTimer = null;
    }, dependencies.gestureLockMs ?? 250);
  }

  return {
    handleWheel,
    destroy() {
      destroyed = true;
      if (gestureTimer) {
        clearTimeout(gestureTimer);
        gestureTimer = null;
      }
    },
  };
}

function scrollToEntryBoundary(container: ScrollContainer, direction: JournalDirection) {
  container.scrollTop = direction === "previous" ? container.scrollHeight : 0;
}
