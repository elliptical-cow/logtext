import assert from "node:assert/strict";
import test from "node:test";

import {
  ancestorFolderPaths,
  buildNavigationTree,
  flattenVisibleTree,
  folderExists,
  pageNameFromPath,
} from "../src/lib/navigationTree.js";
import type { PageSummary } from "../src/lib/types.js";

const pages: PageSummary[] = [
  { exists: true, key: "team/nadine", path: "team/nadine.md", title: "nadine", modifiedAt: 100 },
  { exists: true, key: "team/jens", path: "team/jens.md", title: "jens", modifiedAt: 300 },
  { exists: true, key: "projects/forecasts", path: "projects/forecasts.md", title: "forecasts", modifiedAt: 50 },
  { exists: true, key: "zettel", path: "zettel.md", title: "zettel", modifiedAt: 200 },
  { exists: true, key: "inbox", path: "inbox.md", title: "inbox", modifiedAt: 400 },
];

test("builds a folder-first navigation tree", () => {
  const tree = buildNavigationTree(pages);
  assert.deepEqual(
    tree.children.map((node) => `${node.kind}:${node.path}`),
    ["folder:projects", "folder:team", "page:zettel.md", "page:inbox.md"],
  );
});

test("uses file names instead of headings as page labels", () => {
  const tree = buildNavigationTree([
    { exists: true, key: "projects/roadmap", path: "projects/roadmap.md", title: "Strategic Plan", modifiedAt: 0 },
  ]);
  const rows = flattenVisibleTree(tree, new Set(["projects"]));

  assert.equal(rows[1].node.kind, "page");
  assert.equal(rows[1].node.name, "roadmap");
  assert.equal(pageNameFromPath("projects/roadmap.md"), "roadmap");
});

test("flattens only expanded folders", () => {
  const tree = buildNavigationTree(pages);
  const rows = flattenVisibleTree(tree, new Set(["projects", "team"]));
  assert.deepEqual(
    rows.map((row) => `${row.depth}:${row.node.kind}:${row.node.path}`),
    [
      "0:folder:projects",
      "1:page:projects/forecasts.md",
      "0:folder:team",
      "1:page:team/nadine.md",
      "1:page:team/jens.md",
      "0:page:zettel.md",
      "0:page:inbox.md",
    ],
  );
});

test("applies folder-specific page sort order", () => {
  const tree = buildNavigationTree(pages, [], "name-desc", { team: "name-asc" });
  const rows = flattenVisibleTree(tree, new Set(["team"]));

  assert.deepEqual(
    rows.map((row) => `${row.depth}:${row.node.kind}:${row.node.path}`),
    [
      "0:folder:projects",
      "0:folder:team",
      "1:page:team/jens.md",
      "1:page:team/nadine.md",
      "0:page:zettel.md",
      "0:page:inbox.md",
    ],
  );
});

test("sorts recently opened pages first and unopened pages by name", () => {
  const tree = buildNavigationTree(
    pages,
    [],
    "opened-desc",
    {},
    {},
    {
      "inbox.md": 100,
      "zettel.md": 300,
      "team/jens.md": 200,
    },
  );
  const rows = flattenVisibleTree(tree, new Set(["team"]));

  assert.deepEqual(
    rows.map((row) => `${row.depth}:${row.node.kind}:${row.node.path}`),
    [
      "0:folder:projects",
      "0:folder:team",
      "1:page:team/jens.md",
      "1:page:team/nadine.md",
      "0:page:zettel.md",
      "0:page:inbox.md",
    ],
  );
});

test("sorts recently modified pages first globally and per folder", () => {
  const tree = buildNavigationTree(pages, [], "modified-desc", { team: "modified-desc" });
  const rows = flattenVisibleTree(tree, new Set(["team"]));

  assert.deepEqual(
    rows.map((row) => `${row.depth}:${row.node.kind}:${row.node.path}`),
    [
      "0:folder:projects",
      "0:folder:team",
      "1:page:team/jens.md",
      "1:page:team/nadine.md",
      "0:page:inbox.md",
      "0:page:zettel.md",
    ],
  );
});

test("applies manual order before configured sort order", () => {
  const tree = buildNavigationTree(pages, [], "name-desc", {}, {
    "": ["inbox.md", "team"],
    team: ["team/jens.md", "team/nadine.md"],
  });
  const rows = flattenVisibleTree(tree, new Set(["team"]));

  assert.deepEqual(
    rows.map((row) => `${row.depth}:${row.node.kind}:${row.node.path}`),
    [
      "0:page:inbox.md",
      "0:folder:team",
      "1:page:team/jens.md",
      "1:page:team/nadine.md",
      "0:folder:projects",
      "0:page:zettel.md",
    ],
  );
});

test("includes empty folders in navigation tree", () => {
  const tree = buildNavigationTree(pages, ["archive/empty"]);
  const rows = flattenVisibleTree(tree, new Set(["archive"]));

  assert.deepEqual(
    rows.map((row) => `${row.depth}:${row.node.kind}:${row.node.path}`),
    [
      "0:folder:archive",
      "1:folder:archive/empty",
      "0:folder:projects",
      "0:folder:team",
      "0:page:zettel.md",
      "0:page:inbox.md",
    ],
  );
});

test("finds folder ancestors and existing folders", () => {
  const tree = buildNavigationTree(pages);
  assert.deepEqual(ancestorFolderPaths("projects/forecasts.md"), ["projects"]);
  assert.equal(folderExists(tree, "projects"), true);
  assert.equal(folderExists(tree, "missing"), false);
});
