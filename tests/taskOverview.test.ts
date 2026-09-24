import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  availableTaskAttributeNames,
  availableTaskLinks,
  filterTasks,
  groupTasks,
  taskAttributeDisplayValue,
  taskLinkIdentity,
  taskOverviewRowClickAction,
  type TaskOverviewFilters,
} from "../src/lib/taskOverview.js";
import type { TaskAttribute, TaskItem, TaskLink } from "../src/lib/types.js";

const root = process.cwd();

const peter: TaskLink = {
  target: "people/Peter",
  label: "Peter",
  resolvedPath: "people/Peter.md",
  exists: true,
};
const missingProject: TaskLink = {
  target: "Missing Project",
  label: "Missing Project",
  resolvedPath: null,
  exists: false,
};

function task(overrides: Partial<TaskItem> = {}): TaskItem {
  return {
    path: "Inbox.md",
    title: "Inbox",
    line: 1,
    status: "TODO",
    priority: null,
    sourceHeadings: [],
    parentBlocks: [],
    linkedPages: [],
    attributes: [],
    text: "TODO Prepare plan",
    markdown: "- TODO Prepare plan",
    ...overrides,
  };
}

function filters(overrides: Partial<TaskOverviewFilters> = {}): TaskOverviewFilters {
  return {
    status: "ALL",
    priority: "ALL",
    text: "",
    linkedPage: "",
    attributeName: "",
    attributeMode: "has",
    attributeValue: "",
    ...overrides,
  };
}

test("builds stable deduplicated linked-page filter options", () => {
  const duplicate = { ...peter, target: "PEOPLE/PETER", label: "P. Miller" };
  const options = availableTaskLinks([
    task({ linkedPages: [peter, missingProject] }),
    task({ line: 2, linkedPages: [duplicate] }),
  ]);

  assert.equal(taskLinkIdentity(peter), "path:people/peter.md");
  assert.deepEqual(
    options.map(([identity]) => identity).sort(),
    ["missing:missing project", "path:people/peter.md"],
  );
});

test("combines status, linked-page, and inherited attribute filters with AND", () => {
  const inheritedOwner: TaskAttribute = {
    line: 1,
    name: "Owner",
    value: "Peter",
    inherited: true,
  };
  const tasks = [
    task({ linkedPages: [peter], attributes: [inheritedOwner] }),
    task({ line: 2, status: "DONE", linkedPages: [peter], attributes: [inheritedOwner] }),
    task({ line: 3, linkedPages: [], attributes: [inheritedOwner] }),
  ];

  const result = filterTasks(
    tasks,
    filters({
      status: "OPEN",
      linkedPage: "path:people/peter.md",
      attributeName: "owner",
      attributeValue: "pet",
    }),
    "DONE",
  );

  assert.deepEqual(result.map((item) => item.line), [1]);
});

test("supports attribute presence, value, and missing filters case-insensitively", () => {
  const tasks = [
    task({ attributes: [{ line: 2, name: "Region", value: "North", inherited: false }] }),
    task({ line: 3 }),
  ];

  assert.deepEqual(
    filterTasks(tasks, filters({ attributeName: "region" }), "DONE").map((item) => item.line),
    [1],
  );
  assert.deepEqual(
    filterTasks(
      tasks,
      filters({ attributeName: "REGION", attributeValue: "ORTH" }),
      "DONE",
    ).map((item) => item.line),
    [1],
  );
  assert.deepEqual(
    filterTasks(
      tasks,
      filters({ attributeName: "region", attributeMode: "missing" }),
      "DONE",
    ).map((item) => item.line),
    [3],
  );
});

test("includes effective attribute names and values in task text search", () => {
  const tasks = [
    task({ attributes: [{ line: 2, name: "Owner", value: "Peter", inherited: true }] }),
  ];

  assert.equal(filterTasks(tasks, filters({ text: "owner" }), "DONE").length, 1);
  assert.equal(filterTasks(tasks, filters({ text: "peter" }), "DONE").length, 1);
});

test("groups tasks by multiple, empty, and missing attribute values", () => {
  const tasks = [
    task({
      attributes: [
        { line: 2, name: "team", value: "Core", inherited: true },
        { line: 3, name: "TEAM", value: "", inherited: true },
      ],
    }),
    task({ line: 4 }),
  ];

  const groups = groupTasks(tasks, "attribute", "team", (link) => link.label);

  assert.deepEqual(
    groups.map((group) => [group.label, group.items.map((item) => item.line)]),
    [
      ["(empty)", [1]],
      ["Core", [1]],
      ["No team", [4]],
    ],
  );
  assert.deepEqual(availableTaskAttributeNames(tasks), [["team", "team"]]);
});

test("keeps group identities separate from display labels and normalizes values", () => {
  const duplicateTitleLink = {
    ...peter,
    target: "teams/Peter",
    resolvedPath: "teams/Peter.md",
  };
  const linkedGroups = groupTasks(
    [
      task({ linkedPages: [peter] }),
      task({ line: 2, linkedPages: [duplicateTitleLink] }),
    ],
    "linked-page",
    "",
    () => "Peter",
  );
  assert.deepEqual(linkedGroups.map((group) => [group.label, group.items.length]), [
    ["Peter", 1],
    ["Peter", 1],
  ]);

  const attributeGroups = groupTasks(
    [
      task({ attributes: [{ line: 2, name: "team", value: "Core", inherited: false }] }),
      task({ line: 3, attributes: [{ line: 4, name: "team", value: "core", inherited: false }] }),
      task({ line: 5, attributes: [{ line: 6, name: "team", value: "", inherited: false }] }),
      task({
        line: 7,
        attributes: [{ line: 8, name: "team", value: "(empty)", inherited: false }],
      }),
    ],
    "attribute",
    "team",
    (link) => link.label,
  );
  assert.deepEqual(
    attributeGroups.map((group) => [group.label, group.items.map((item) => item.line)]),
    [
      ["(empty)", [5]],
      ["(empty)", [7]],
      ["Core", [1, 3]],
    ],
  );
});

test("formats valid status timestamps locally and preserves invalid values", () => {
  const valid = {
    line: 2,
    name: "status-changed-at",
    value: "2026-09-16T12:32:18Z",
    inherited: false,
  };
  const invalid = { ...valid, value: "not-a-date" };

  assert.match(taskAttributeDisplayValue(valid, "en-GB", "UTC"), /16 Sept 2026.*12:32/);
  assert.equal(taskAttributeDisplayValue(invalid, "en-GB", "UTC"), "not-a-date");
});

test("opens task rows while preserving nested link actions", () => {
  assert.deepEqual(taskOverviewRowClickAction(undefined), { type: "open-task" });
  assert.deepEqual(taskOverviewRowClickAction("logtext:Projects%2FAlpha.md"), {
    type: "open-page",
    target: "Projects/Alpha.md",
  });
  assert.deepEqual(taskOverviewRowClickAction("logtext-missing:Project%20Beta"), {
    type: "missing-page",
    target: "Project Beta",
  });
  assert.deepEqual(taskOverviewRowClickAction("https://example.com"), {
    type: "follow-link",
  });
  assert.deepEqual(taskOverviewRowClickAction(null), { type: "follow-link" });
});

test("wires the complete task row without adding nested controls to the tab order", () => {
  const component = readFileSync(
    join(root, "src/lib/components/TaskOverview.svelte"),
    "utf8",
  );

  assert.match(
    component,
    /class="task-overview-row"[\s\S]*?on:click=\{\(event\) => handleTaskRowClick\(task, event\)\}/,
  );
  assert.match(component, /function handleTaskRowClick\(task: TaskItem, event: MouseEvent\)/);
  assert.equal(/on:click\|stopPropagation=.*openTaskContextMenu/.test(component), false);
  assert.match(component, /title="Right-click to change task"/);
  assert.match(component, /title=\{`Priority #\$\{task\.priority\}\. Right-click to change task`\}/);
  assert.match(component, /function editTaskFromButton[\s\S]*?event\.stopPropagation\(\)/);
  assert.match(component, /class="task-open-button"[\s\S]*?tabindex="-1"/);
  assert.match(component, /class="task-overview-main"[\s\S]*?role="button"/);
  assert.match(component, /replaceAll\("<a ", '<a tabindex="-1" '\)/);
});

test("wires linked-page and attribute state through the task overview config", () => {
  const component = readFileSync(
    join(root, "src/lib/components/TaskOverview.svelte"),
    "utf8",
  );
  const workspaceStore = readFileSync(join(root, "src/lib/stores/workspace.ts"), "utf8");
  const api = readFileSync(join(root, "src/lib/api.ts"), "utf8");

  for (const field of [
    "linkedPageFilter",
    "attributeFilterName",
    "attributeFilterMode",
    "attributeFilterValue",
    "groupAttributeName",
  ]) {
    assert.match(component, new RegExp(`${field} = config\\.${field}`));
    assert.match(component, new RegExp(`\\b${field},`));
  }
  assert.match(component, /class="task-overview-attributes"/);
  assert.match(component, /attribute\.inherited/);
  assert.match(component, /\$: taskOverviewConfigDraft = \{/);
  assert.match(
    component,
    /scheduleTaskOverviewConfigSave\(taskOverviewConfigDraft, \$workspaceStore\.root\)/,
  );
  assert.match(component, /if \(\$workspaceStore\.root === root && loadedRoot === root\)/);
  assert.match(component, /!\$workspaceStore\.taskStates\.includes\(statusFilter\)/);
  assert.match(component, /statusFilter = "OPEN"/);
  assert.match(component, /!availablePriorities\.includes\(priorityFilter\)/);
  assert.match(component, /priorityFilter = "ALL"/);
  assert.match(workspaceStore, /saveTaskOverviewConfigCommand\(taskOverview, root\)/);
  assert.match(api, /expectedWorkspaceRoot/);
});
