export type JournalDay = "yesterday" | "today" | "tomorrow";
export type JournalDirection = "previous" | "next";
export type JournalSortDirection = "asc" | "desc";
export type JournalFeedDirection = "before" | "after";
export type JournalFeedWindow = { start: number; end: number };

export const DEFAULT_JOURNAL_FOLDER = "journal";

export function journalPath(date = new Date(), root = DEFAULT_JOURNAL_FOLDER) {
  return `${normalizeJournalFolder(root)}/${formatDate(date)}.md`;
}

export function journalPathForDay(
  day: JournalDay,
  date = new Date(),
  root = DEFAULT_JOURNAL_FOLDER,
) {
  const target = new Date(date);

  if (day === "yesterday") {
    target.setDate(target.getDate() - 1);
  } else if (day === "tomorrow") {
    target.setDate(target.getDate() + 1);
  }

  return journalPath(target, root);
}

export function journalPathForDateInput(dateInput: string, root = DEFAULT_JOURNAL_FOLDER) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateInput);
  if (!match) {
    return null;
  }

  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  if (
    date.getFullYear() !== Number(year) ||
    date.getMonth() !== Number(month) - 1 ||
    date.getDate() !== Number(day)
  ) {
    return null;
  }

  return journalPath(date, root);
}

export function isJournalPagePath(path: string, root = DEFAULT_JOURNAL_FOLDER) {
  const normalizedRoot = normalizeJournalFolder(root);
  const prefix = `${normalizedRoot}/`;
  if (!path.startsWith(prefix)) {
    return false;
  }

  const fileName = path.slice(prefix.length);
  if (fileName.includes("/")) {
    return false;
  }

  const match = /^(\d{4}-\d{2}-\d{2})\.md$/.exec(fileName);
  return Boolean(match && journalPathForDateInput(match[1], normalizedRoot) === path);
}

export function shouldUseContinuousJournalView(
  path: string | null,
  root: string,
  enabled: boolean,
) {
  return enabled && path !== null && isJournalPagePath(path, root);
}

export function adjacentJournalPath(
  currentPath: string,
  pagePaths: string[],
  root: string,
  direction: JournalDirection,
  sortDirection: JournalSortDirection = "asc",
) {
  const journalPaths = orderedJournalPaths(pagePaths, root, sortDirection);
  const currentIndex = journalPaths.findIndex(
    (path) => path.toLocaleLowerCase() === currentPath.toLocaleLowerCase(),
  );
  if (currentIndex < 0) {
    return null;
  }

  return journalPaths[currentIndex + (direction === "previous" ? -1 : 1)] ?? null;
}

export function orderedJournalPaths(
  pagePaths: string[],
  root = DEFAULT_JOURNAL_FOLDER,
  sortDirection: JournalSortDirection = "asc",
) {
  const journalPaths = pagePaths.filter((path) => isJournalPagePath(path, root)).sort();
  return sortDirection === "desc" ? journalPaths.reverse() : journalPaths;
}

export function initialJournalFeedWindow(
  anchorIndex: number,
  pathCount: number,
  radius = 2,
): JournalFeedWindow {
  return {
    start: Math.max(0, anchorIndex - radius),
    end: Math.min(pathCount - 1, anchorIndex + radius),
  };
}

export function expandJournalFeedWindow(
  window: JournalFeedWindow,
  pathCount: number,
  direction: JournalFeedDirection,
  batchSize = 2,
): JournalFeedWindow {
  return direction === "before"
    ? { start: Math.max(0, window.start - batchSize), end: window.end }
    : { start: window.start, end: Math.min(pathCount - 1, window.end + batchSize) };
}

export function journalBoundaryDirection(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  deltaY: number,
): JournalDirection | null {
  if (deltaY < 0 && scrollTop <= 1) {
    return "previous";
  }
  if (deltaY > 0 && scrollTop + clientHeight >= scrollHeight - 1) {
    return "next";
  }
  return null;
}

export function normalizeJournalFolder(root: string) {
  const normalized = root.trim().replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
  return normalized || DEFAULT_JOURNAL_FOLDER;
}

function formatDate(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");

  return `${year}-${month}-${day}`;
}
