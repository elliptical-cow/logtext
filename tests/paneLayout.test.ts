import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { paneGridTemplate, withPaneVisibility } from "../src/lib/paneLayout.js";
import type { NavigationLayoutConfig } from "../src/lib/types.js";

const dimensions = {
  leftWidth: 280,
  rightWidth: 440,
  minLeftWidth: 220,
  minMiddleWidth: 360,
  minRightWidth: 280,
  resizerWidth: 6,
  collapsedPaneWidth: 32,
};

const visibleLayout: NavigationLayoutConfig = {
  quickAccessHeight: 220,
  leftPaneVisible: true,
  middlePaneVisible: true,
  rightPaneVisible: true,
};

test("pane grid lets the remaining content pane expand", () => {
  assert.equal(
    paneGridTemplate(visibleLayout, dimensions),
    "280px 6px minmax(360px, 1fr) 6px 440px",
  );
  assert.equal(
    paneGridTemplate({ ...visibleLayout, leftPaneVisible: false }, dimensions),
    "32px 6px minmax(360px, 1fr) 6px 440px",
  );
  assert.equal(
    paneGridTemplate({ ...visibleLayout, rightPaneVisible: false }, dimensions),
    "280px 6px minmax(360px, 1fr) 6px 32px",
  );
  assert.equal(
    paneGridTemplate({ ...visibleLayout, middlePaneVisible: false }, dimensions),
    "280px 6px 32px 6px minmax(280px, 1fr)",
  );
  assert.equal(
    paneGridTemplate(
      { ...visibleLayout, middlePaneVisible: false, rightPaneVisible: false },
      dimensions,
    ),
    "minmax(220px, 1fr) 6px 32px 6px 32px",
  );
  assert.equal(
    paneGridTemplate(
      {
        ...visibleLayout,
        leftPaneVisible: false,
        middlePaneVisible: false,
        rightPaneVisible: false,
      },
      dimensions,
    ),
    "minmax(32px, 1fr) 6px 32px 6px 32px",
  );
});

test("changing pane visibility preserves the other workspace layout settings", () => {
  const hidden = withPaneVisibility(visibleLayout, "middle", false);

  assert.deepEqual(hidden, {
    quickAccessHeight: 220,
    leftPaneVisible: true,
    middlePaneVisible: false,
    rightPaneVisible: true,
  });
  assert.deepEqual(visibleLayout, {
    quickAccessHeight: 220,
    leftPaneVisible: true,
    middlePaneVisible: true,
    rightPaneVisible: true,
  });
});

test("keeps hidden pane components mounted and wires accessible menu actions", () => {
  const root = process.cwd();
  const app = readFileSync(join(root, "src/App.svelte"), "utf8");
  const backend = readFileSync(join(root, "src-tauri/src/lib.rs"), "utf8");
  const events = readFileSync(join(root, "src/lib/coreEvents.ts"), "utf8");
  const paneButton = readFileSync(
    join(root, "src/lib/components/PaneVisibilityButton.svelte"),
    "utf8",
  );
  const editorPane = readFileSync(join(root, "src/lib/components/EditorPane.svelte"), "utf8");
  const rightPane = readFileSync(join(root, "src/lib/components/RightPane.svelte"), "utf8");
  const taskOverview = readFileSync(
    join(root, "src/lib/components/TaskOverview.svelte"),
    "utf8",
  );
  const taskListPanel = readFileSync(
    join(root, "src/lib/components/TaskListPanel.svelte"),
    "utf8",
  );

  assert.match(app, /hidden=\{!\$workspaceStore\.navigationLayout\.leftPaneVisible\}/);
  assert.match(app, /hidden=\{!\$workspaceStore\.navigationLayout\.middlePaneVisible\}/);
  assert.match(app, /hidden=\{!\$workspaceStore\.navigationLayout\.rightPaneVisible\}/);
  assert.match(app, /class="workspace-pane-rail"/);
  assert.match(app, /<PaneVisibilityButton pane="left" expanded=\{false\}/);
  assert.match(app, /<PaneVisibilityButton pane="middle" expanded=\{false\}/);
  assert.match(app, /<PaneVisibilityButton pane="right" expanded=\{false\}/);
  assert.equal(
    /\{#if \$workspaceStore\.navigationLayout\.middlePaneVisible\}[\s\S]*?<EditorPane/.test(app),
    false,
  );
  assert.match(backend, /SubmenuBuilder::new\(handle, "Hide\/Show Panes"\)/);
  assert.match(backend, /\.accelerator\("CmdOrCtrl\+Alt\+L"\)/);
  assert.match(backend, /pane_visibility_menu_text\("Middle", true\)/);
  assert.match(backend, /\.accelerator\("CmdOrCtrl\+Alt\+M"\)/);
  assert.match(backend, /\.accelerator\("CmdOrCtrl\+Alt\+R"\)/);
  assert.match(events, /onCoreEvent\("menu-toggle-left-pane"/);
  assert.match(events, /onCoreEvent\("menu-toggle-middle-pane"/);
  assert.match(events, /onCoreEvent\("menu-toggle-right-pane"/);
  assert.match(events, /updatePaneVisibilityMenu\([\s\S]*leftPaneVisible,[\s\S]*middlePaneVisible,[\s\S]*rightPaneVisible,[\s\S]*enabled/);
  assert.match(paneButton, /logtext-toggle-\$\{pane\}-pane/);
  assert.match(paneButton, /aria-label=\{actionLabel\}/);
  assert.match(paneButton, /aria-expanded=\{expanded\}/);
  assert.match(paneButton, /symbol = expanded \? "−" : "\+"/);
  assert.match(paneButton, /detail: \{ focusPaneControl: true \}/);
  assert.match(paneButton, /data-pane-visibility-control=\{pane\}/);
  assert.match(app, /data-pane-visibility-control=.*data-pane-expanded/);
  assert.match(editorPane, /<PaneVisibilityButton pane="middle"/);
  assert.match(rightPane, /<PaneVisibilityButton pane="right"/);
  assert.match(taskOverview, /<PaneVisibilityButton pane="middle"/);
  assert.match(taskListPanel, /<PaneVisibilityButton pane="left"/);
});
