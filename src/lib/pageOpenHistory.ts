export type LastOpenedAt = Record<string, number>;

export function recordPageOpen(
  lastOpenedAt: LastOpenedAt,
  path: string,
  openedAt: number,
): LastOpenedAt {
  const matchingPath = Object.keys(lastOpenedAt).find(
    (candidate) => candidate.toLocaleLowerCase() === path.toLocaleLowerCase(),
  );
  const previous = matchingPath ? lastOpenedAt[matchingPath] : 0;
  const next = { ...lastOpenedAt };
  if (matchingPath && matchingPath !== path) {
    delete next[matchingPath];
  }
  next[path] = Math.max(previous, openedAt);
  return next;
}

export function removePageOpenHistory(
  lastOpenedAt: LastOpenedAt,
  removedPaths: readonly string[],
): LastOpenedAt {
  const removed = new Set(removedPaths);
  return Object.fromEntries(
    Object.entries(lastOpenedAt).filter(([path]) => !removed.has(path)),
  );
}

export function remapPageOpenHistoryPath(
  lastOpenedAt: LastOpenedAt,
  oldPath: string,
  newPath: string,
): LastOpenedAt {
  if (oldPath === newPath || !(oldPath in lastOpenedAt)) {
    return lastOpenedAt;
  }

  const next = { ...lastOpenedAt };
  const timestamp = next[oldPath];
  delete next[oldPath];
  next[newPath] = Math.max(timestamp, next[newPath] ?? 0);
  return next;
}

export function remapPageOpenHistoryFolder(
  lastOpenedAt: LastOpenedAt,
  oldFolder: string,
  newFolder: string,
): LastOpenedAt {
  const oldPrefix = `${oldFolder}/`;
  const next: LastOpenedAt = {};

  for (const [path, timestamp] of Object.entries(lastOpenedAt)) {
    const suffix = path.startsWith(oldPrefix) ? path.slice(oldPrefix.length) : null;
    const mappedPath = suffix === null ? path : newFolder ? `${newFolder}/${suffix}` : suffix;
    next[mappedPath] = Math.max(timestamp, next[mappedPath] ?? 0);
  }

  return next;
}
