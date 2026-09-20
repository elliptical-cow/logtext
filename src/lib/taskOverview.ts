import type {
  TaskAttribute,
  TaskAttributeFilterMode,
  TaskItem,
  TaskLink,
  TaskOverviewGroupMode,
  TaskStatus,
} from "./types.js";

export type TaskOverviewFilters = {
  status: "OPEN" | TaskStatus | "ALL";
  priority: "ALL" | "NONE" | string;
  text: string;
  linkedPage: string;
  attributeName: string;
  attributeMode: TaskAttributeFilterMode;
  attributeValue: string;
};

export type TaskGroup = {
  label: string;
  items: TaskItem[];
};

export function taskLinkIdentity(link: TaskLink) {
  return link.resolvedPath
    ? `path:${normalizeIdentity(link.resolvedPath)}`
    : `missing:${normalizeIdentity(link.target)}`;
}

export function availableTaskLinks(tasks: TaskItem[]) {
  const links = new Map<string, TaskLink>();
  for (const task of tasks) {
    for (const link of task.linkedPages) {
      const identity = taskLinkIdentity(link);
      if (!links.has(identity)) {
        links.set(identity, link);
      }
    }
  }
  return [...links.entries()].sort((left, right) =>
    taskLinkOptionLabel(left[1]).localeCompare(taskLinkOptionLabel(right[1])),
  );
}

export function availableTaskAttributeNames(tasks: TaskItem[]) {
  const names = new Map<string, string>();
  for (const task of tasks) {
    for (const attribute of task.attributes) {
      const normalized = normalizeAttributeName(attribute.name);
      if (!names.has(normalized)) {
        names.set(normalized, attribute.name);
      }
    }
  }
  return [...names.entries()].sort((left, right) => left[1].localeCompare(right[1]));
}

export function filterTasks(
  tasks: TaskItem[],
  filters: TaskOverviewFilters,
  closedStatus: TaskStatus,
) {
  const normalizedQuery = filters.text.trim().toLowerCase();
  const normalizedAttributeName = normalizeAttributeName(filters.attributeName);
  const normalizedAttributeValue = filters.attributeValue.trim().toLowerCase();

  return tasks.filter((task) => {
    const statusMatches =
      filters.status === "ALL" ||
      (filters.status === "OPEN" && task.status !== closedStatus) ||
      task.status === filters.status;
    const priorityMatches =
      filters.priority === "ALL" ||
      (filters.priority === "NONE" && !task.priority) ||
      task.priority === filters.priority;
    const textMatches =
      !normalizedQuery ||
      task.text.toLowerCase().includes(normalizedQuery) ||
      task.path.toLowerCase().includes(normalizedQuery) ||
      task.attributes.some(
        (attribute) =>
          attribute.name.toLowerCase().includes(normalizedQuery) ||
          attribute.value.toLowerCase().includes(normalizedQuery),
      );
    const linkedPageMatches =
      !filters.linkedPage ||
      task.linkedPages.some((link) => taskLinkIdentity(link) === filters.linkedPage);
    const matchingAttributes = normalizedAttributeName
      ? task.attributes.filter(
          (attribute) => normalizeAttributeName(attribute.name) === normalizedAttributeName,
        )
      : [];
    const attributeMatches =
      !normalizedAttributeName ||
      (filters.attributeMode === "missing"
        ? matchingAttributes.length === 0
        : matchingAttributes.some(
            (attribute) =>
              !normalizedAttributeValue ||
              attribute.value.toLowerCase().includes(normalizedAttributeValue),
          ));

    return (
      statusMatches &&
      priorityMatches &&
      textMatches &&
      linkedPageMatches &&
      attributeMatches
    );
  });
}

export function groupTasks(
  tasks: TaskItem[],
  mode: TaskOverviewGroupMode,
  groupAttributeName: string,
  linkedPageLabel: (link: TaskLink) => string,
): TaskGroup[] {
  const groups = new Map<string, TaskItem[]>();

  for (const task of tasks) {
    for (const key of groupKeys(task, mode, groupAttributeName, linkedPageLabel)) {
      groups.set(key, [...(groups.get(key) ?? []), task]);
    }
  }

  return [...groups.entries()]
    .map(([label, items]) => ({ label, items: [...items].sort(compareTasks) }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

export function taskAttributeDisplayValue(
  attribute: TaskAttribute,
  locales?: Intl.LocalesArgument,
  timeZone?: string,
) {
  if (normalizeAttributeName(attribute.name) !== "status-changed-at") {
    return attribute.value;
  }

  const timestamp = Date.parse(attribute.value);
  if (!Number.isFinite(timestamp)) {
    return attribute.value;
  }

  return new Intl.DateTimeFormat(locales, {
    dateStyle: "medium",
    timeStyle: "short",
    ...(timeZone ? { timeZone } : {}),
  }).format(new Date(timestamp));
}

function groupKeys(
  task: TaskItem,
  mode: TaskOverviewGroupMode,
  groupAttributeName: string,
  linkedPageLabel: (link: TaskLink) => string,
) {
  if (mode === "status") {
    return [task.status];
  }
  if (mode === "folder") {
    return [task.path.includes("/") ? task.path.split("/").slice(0, -1).join("/") : "/"];
  }
  if (mode === "priority") {
    return [task.priority ? `#${task.priority}` : "No priority"];
  }
  if (mode === "linked-page") {
    return task.linkedPages.length === 0
      ? ["No linked page"]
      : uniqueStrings(task.linkedPages.map(linkedPageLabel));
  }
  if (mode === "attribute") {
    const normalizedName = normalizeAttributeName(groupAttributeName);
    const values = task.attributes
      .filter((attribute) => normalizeAttributeName(attribute.name) === normalizedName)
      .map((attribute) => attribute.value || "(empty)");
    return values.length > 0
      ? uniqueStrings(values)
      : [`No ${groupAttributeName || "attribute"}`];
  }
  return [task.title];
}

function compareTasks(left: TaskItem, right: TaskItem) {
  const priorityCompare = comparePriorityValues(left.priority, right.priority);
  if (priorityCompare !== 0) {
    return priorityCompare;
  }
  const pathCompare = right.path.localeCompare(left.path);
  return pathCompare || left.line - right.line;
}

export function comparePriorityValues(left: string | null, right: string | null) {
  if (left && !right) {
    return -1;
  }
  if (!left && right) {
    return 1;
  }
  if (!left || !right) {
    return 0;
  }
  return left.localeCompare(right, undefined, { numeric: true });
}

function normalizeAttributeName(value: string) {
  return value.trim().toLowerCase();
}

function normalizeIdentity(value: string) {
  return value.trim().replaceAll("\\", "/").toLowerCase();
}

function taskLinkOptionLabel(link: TaskLink) {
  return link.exists ? link.label : `Missing: ${link.label || link.target}`;
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const normalized = value.toLowerCase();
    if (seen.has(normalized)) {
      return false;
    }
    seen.add(normalized);
    return true;
  });
}
