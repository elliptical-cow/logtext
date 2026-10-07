import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  filterWorkspaceHealthIssues,
  groupWorkspaceHealthIssues,
} from "../src/lib/workspaceHealth.js";
import type { WorkspaceHealthIssue } from "../src/lib/types.js";

const issues: WorkspaceHealthIssue[] = [
  {
    kind: "missing-wiki-target",
    severity: "warning",
    path: "Projects/Alpha.md",
    line: 7,
    target: "missing page",
    message: "Wiki link target does not exist.",
    context: "- [[Missing Page]]",
  },
  {
    kind: "orphan-page",
    severity: "info",
    path: "Inbox.md",
    line: null,
    target: null,
    message: "Page has no incoming links from another page.",
    context: "Inbox",
  },
];

test("filters workspace health issues by kind, severity, and searchable source data", () => {
  assert.deepEqual(
    filterWorkspaceHealthIssues(issues, {
      text: "alpha",
      kind: "missing-wiki-target",
      severity: "warning",
    }),
    [issues[0]],
  );
  assert.deepEqual(
    filterWorkspaceHealthIssues(issues, { text: "inbox", kind: "all", severity: "info" }),
    [issues[1]],
  );
});

test("groups workspace health issues in a stable diagnostic order", () => {
  assert.deepEqual(
    groupWorkspaceHealthIssues(issues).map((group) => [group.kind, group.issues.length]),
    [
      ["missing-wiki-target", 1],
      ["orphan-page", 1],
    ],
  );
});

test("wires workspace health through the backend, View menu, and middle workspace view", () => {
  const app = readFileSync(join(process.cwd(), "src/App.svelte"), "utf8");
  const core = readFileSync(join(process.cwd(), "src/lib/coreEvents.ts"), "utf8");
  const backend = readFileSync(join(process.cwd(), "src-tauri/src/lib.rs"), "utf8");

  assert.match(app, /<WorkspaceHealth \/>/);
  assert.match(app, /case "view\.workspaceHealth"/);
  assert.match(core, /menu-workspace-health/);
  assert.match(backend, /workspace_health::get_workspace_health/);
  assert.match(backend, /MENU_WORKSPACE_HEALTH, "Workspace Health"/);

  const component = readFileSync(
    join(process.cwd(), "src/lib/components/WorkspaceHealth.svelte"),
    "utf8",
  );
  assert.match(component, /Create Page/);
  assert.match(component, /createAndOpen\(issue\.target, "right"\)/);
});
