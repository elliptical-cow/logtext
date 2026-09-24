export type RovingKey = "ArrowDown" | "ArrowUp" | "Home" | "End";

export function nextRovingIndex(
  currentIndex: number,
  itemCount: number,
  key: string,
) {
  if (itemCount <= 0 || !isRovingKey(key)) {
    return null;
  }
  if (key === "Home") return 0;
  if (key === "End") return itemCount - 1;
  const delta = key === "ArrowDown" ? 1 : -1;
  return (currentIndex + delta + itemCount) % itemCount;
}

export function parentTreeIndex(depths: readonly number[], currentIndex: number) {
  const currentDepth = depths[currentIndex];
  if (currentDepth === undefined || currentDepth <= 0) return null;
  for (let index = currentIndex - 1; index >= 0; index -= 1) {
    if (depths[index] < currentDepth) return index;
  }
  return null;
}

export function firstChildTreeIndex(depths: readonly number[], currentIndex: number) {
  const currentDepth = depths[currentIndex];
  const nextDepth = depths[currentIndex + 1];
  return currentDepth !== undefined && nextDepth !== undefined && nextDepth > currentDepth
    ? currentIndex + 1
    : null;
}

export function calendarDateForKey(current: Date, key: string) {
  const next = new Date(current);
  if (key === "ArrowLeft") next.setDate(current.getDate() - 1);
  else if (key === "ArrowRight") next.setDate(current.getDate() + 1);
  else if (key === "ArrowUp") next.setDate(current.getDate() - 7);
  else if (key === "ArrowDown") next.setDate(current.getDate() + 7);
  else if (key === "Home") next.setDate(current.getDate() - ((current.getDay() + 6) % 7));
  else if (key === "End") next.setDate(current.getDate() + (6 - ((current.getDay() + 6) % 7)));
  else if (key === "PageUp") return sameDayInMonth(current, -1);
  else if (key === "PageDown") return sameDayInMonth(current, 1);
  else return null;
  return next;
}

function sameDayInMonth(current: Date, offset: number) {
  const targetMonth = new Date(current.getFullYear(), current.getMonth() + offset, 1);
  const lastDay = new Date(targetMonth.getFullYear(), targetMonth.getMonth() + 1, 0).getDate();
  return new Date(
    targetMonth.getFullYear(),
    targetMonth.getMonth(),
    Math.min(current.getDate(), lastDay),
  );
}

function isRovingKey(key: string): key is RovingKey {
  return key === "ArrowDown" || key === "ArrowUp" || key === "Home" || key === "End";
}
