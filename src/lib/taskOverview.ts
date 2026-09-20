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

type TaskGroupKey = {
  id: string;
  label: string;
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
  const groups = new Map<string, TaskGroup>();

  for (const task of tasks) {
    for (const key of groupKeys(task, mode, groupAttributeName, linkedPageLabel)) {
      const group = groups.get(key.id);
      if (group) {
        group.items.push(task);
      } else {
        groups.set(key.id, { label: key.label, items: [task] });
      }
    }
  }

  return [...groups.values()]
    .map((group) => ({ ...group, items: group.items.sort(compareTasks) }))
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
    return [groupKey(`status:${normalizeIdentity(task.status)}`, task.status)];
  }
  if (mode === "folder") {
    const folder = task.path.includes("/") ? task.path.split("/").slice(0, -1).join("/") : "/";
    return [groupKey(`folder:${normalizeIdentity(folder)}`, folder)];
  }
  if (mode === "priority") {
    return task.priority
      ? [groupKey(`priority:${normalizeIdentity(task.priority)}`, `#${task.priority}`)]
      : [groupKey("priority:missing", "No priority")];
  }
  if (mode === "linked-page") {
    return task.linkedPages.length === 0
      ? [groupKey("linked-page:missing", "No linked page")]
      : uniqueGroupKeys(
          task.linkedPages.map((link) =>
            groupKey(`linked-page:${taskLinkIdentity(link)}`, linkedPageLabel(link)),
          ),
        );
  }
  if (mode === "attribute") {
    const normalizedName = normalizeAttributeName(groupAttributeName);
    const values = task.attributes
      .filter((attribute) => normalizeAttributeName(attribute.name) === normalizedName)
      .map((attribute) =>
        attribute.value
          ? groupKey(
              `attribute:${normalizedName}:value:${normalizeIdentity(attribute.value)}`,
              attribute.value,
            )
          : groupKey(`attribute:${normalizedName}:empty`, "(empty)"),
      );
    return values.length > 0
      ? uniqueGroupKeys(values)
      : [
          groupKey(
            `attribute:${normalizedName}:missing`,
            `No ${groupAttributeName || "attribute"}`,
          ),
        ];
  }
  return [groupKey(`source:${normalizeIdentity(task.path)}`, task.title)];
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

function groupKey(id: string, label: string): TaskGroupKey {
  return { id, label };
}

function uniqueGroupKeys(values: TaskGroupKey[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (seen.has(value.id)) {
      return false;
    }
    seen.add(value.id);
    return true;
  });
}
