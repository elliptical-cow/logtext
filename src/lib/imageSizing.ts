const IMAGE_WIDTH_MARKER = /(?:^|\s+\|\s+)logtext-width=(\d{2,4})px\s*$/i;
const MIN_IMAGE_WIDTH = 80;
const MAX_IMAGE_WIDTH = 8192;

export type ImageResizeDirection = "smaller" | "larger";

export function logtextImageWidth(title: string | null | undefined) {
  if (!title) {
    return null;
  }
  const match = title.match(IMAGE_WIDTH_MARKER);
  if (!match) {
    return null;
  }
  const width = Number.parseInt(match[1], 10);
  return width >= MIN_IMAGE_WIDTH && width <= MAX_IMAGE_WIDTH ? width : null;
}

export function imageTitleWithoutLogtextWidth(title: string | null | undefined) {
  if (!title) {
    return null;
  }
  const match = title.match(IMAGE_WIDTH_MARKER);
  if (!match) {
    return title;
  }
  const visibleTitle = title.slice(0, match.index).trimEnd();
  return visibleTitle || null;
}

export function imageTitleWithLogtextWidth(
  title: string | null | undefined,
  width: number,
) {
  const visibleTitle = imageTitleWithoutLogtextWidth(title);
  const normalizedWidth = clampImageWidth(width);
  return visibleTitle
    ? `${visibleTitle} | logtext-width=${normalizedWidth}px`
    : `logtext-width=${normalizedWidth}px`;
}

export function nextImageWidth(
  configuredWidth: number | null,
  renderedWidth: number,
  direction: ImageResizeDirection,
) {
  const baseline = configuredWidth ?? renderedWidth;
  const scaled = baseline * (direction === "larger" ? 1.25 : 0.8);
  return clampImageWidth(Math.round(scaled / 10) * 10);
}

function clampImageWidth(width: number) {
  if (!Number.isFinite(width)) {
    return MIN_IMAGE_WIDTH;
  }
  return Math.min(MAX_IMAGE_WIDTH, Math.max(MIN_IMAGE_WIDTH, Math.round(width)));
}
