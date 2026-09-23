import type { NavigationLayoutConfig } from "./types.js";

export type PaneLayoutDimensions = {
  leftWidth: number;
  rightWidth: number;
  minLeftWidth: number;
  minMiddleWidth: number;
  minRightWidth: number;
  resizerWidth: number;
  collapsedPaneWidth: number;
};

export type WorkspacePane = "left" | "middle" | "right";

const paneVisibilityKeys = {
  left: "leftPaneVisible",
  middle: "middlePaneVisible",
  right: "rightPaneVisible",
} as const satisfies Record<WorkspacePane, keyof NavigationLayoutConfig>;

export function paneGridTemplate(
  navigationLayout: NavigationLayoutConfig,
  dimensions: PaneLayoutDimensions,
) {
  const {
    leftWidth,
    rightWidth,
    minLeftWidth,
    minMiddleWidth,
    minRightWidth,
    resizerWidth,
    collapsedPaneWidth,
  } = dimensions;
  const { leftPaneVisible, middlePaneVisible, rightPaneVisible } = navigationLayout;
  const contentPanesHidden = !middlePaneVisible && !rightPaneVisible;

  const leftColumn = leftPaneVisible
    ? contentPanesHidden
      ? `minmax(${minLeftWidth}px, 1fr)`
      : `${leftWidth}px`
    : contentPanesHidden
      ? `minmax(${collapsedPaneWidth}px, 1fr)`
      : `${collapsedPaneWidth}px`;
  const middleColumn = middlePaneVisible
    ? `minmax(${minMiddleWidth}px, 1fr)`
    : `${collapsedPaneWidth}px`;
  let rightColumn = `${collapsedPaneWidth}px`;
  if (rightPaneVisible) {
    rightColumn = middlePaneVisible
      ? `${rightWidth}px`
      : `minmax(${minRightWidth}px, 1fr)`;
  }

  return [
    leftColumn,
    `${resizerWidth}px`,
    middleColumn,
    `${resizerWidth}px`,
    rightColumn,
  ].join(" ");
}

export function withPaneVisibility(
  navigationLayout: NavigationLayoutConfig,
  pane: WorkspacePane,
  visible: boolean,
): NavigationLayoutConfig {
  return {
    ...navigationLayout,
    [paneVisibilityKeys[pane]]: visible,
  };
}

export function isPaneVisible(
  navigationLayout: NavigationLayoutConfig,
  pane: WorkspacePane,
) {
  return navigationLayout[paneVisibilityKeys[pane]];
}
