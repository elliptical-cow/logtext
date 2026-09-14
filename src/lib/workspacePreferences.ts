import type {
  TaskStateColors,
  WorkspacePreferences,
  WorkspaceState,
} from "./types";

export type WorkspacePreferenceErrors = Partial<
  Record<"journalFolder" | "mediaFolder" | "taskStates", string>
>;

export function workspacePreferencesFromState(
  workspace: Pick<
    WorkspaceState,
    | "journalFolder"
    | "mediaFolder"
    | "journalRightPaneContinuousScrolling"
    | "taskStates"
    | "taskStateColors"
    | "taskDoneSoundEnabled"
    | "defaultPageSort"
    | "themeMode"
  >,
): WorkspacePreferences {
  return {
    journalFolder: workspace.journalFolder,
    mediaFolder: workspace.mediaFolder,
    journalRightPaneContinuousScrolling: workspace.journalRightPaneContinuousScrolling,
    taskStates: [...workspace.taskStates],
    taskStateColors: { ...workspace.taskStateColors },
    taskDoneSoundEnabled: workspace.taskDoneSoundEnabled,
    defaultPageSort: workspace.defaultPageSort,
    themeMode: workspace.themeMode,
  };
}

export function normalizeWorkspacePreferences(
  preferences: WorkspacePreferences,
): WorkspacePreferences {
  const taskStates = preferences.taskStates.map((state) => state.trim());
  const taskStateColors: TaskStateColors = {};
  for (const state of taskStates) {
    const originalIndex = taskStates.indexOf(state);
    const originalState = preferences.taskStates[originalIndex];
    taskStateColors[state] = preferences.taskStateColors[originalState] ?? "grey";
  }

  return {
    ...preferences,
    journalFolder: normalizeFolderPath(preferences.journalFolder),
    mediaFolder: normalizeFolderPath(preferences.mediaFolder),
    taskStates,
    taskStateColors,
  };
}

export function validateWorkspacePreferences(
  preferences: WorkspacePreferences,
): WorkspacePreferenceErrors {
  const normalized = normalizeWorkspacePreferences(preferences);
  const errors: WorkspacePreferenceErrors = {};

  if (
    !normalized.journalFolder ||
    hasAbsolutePrefix(preferences.journalFolder) ||
    !isValidFolderPath(normalized.journalFolder)
  ) {
    errors.journalFolder = "Enter a workspace-relative folder without . or .. segments.";
  }
  if (
    !normalized.mediaFolder ||
    hasAbsolutePrefix(preferences.mediaFolder) ||
    !isValidFolderPath(normalized.mediaFolder, true)
  ) {
    errors.mediaFolder =
      "Enter a workspace-relative folder without .git, node_modules, target, . or .. segments.";
  }
  if (
    normalized.journalFolder &&
    normalized.mediaFolder &&
    foldersOverlap(normalized.journalFolder, normalized.mediaFolder)
  ) {
    errors.mediaFolder = "Journal and media folders must not overlap.";
  }

  if (normalized.taskStates.length === 0) {
    errors.taskStates = "Define at least one task state.";
  } else if (normalized.taskStates.some((state) => !/^[A-Z0-9_]+$/.test(state))) {
    errors.taskStates = "Task states may contain only uppercase letters, numbers and _.";
  } else if (new Set(normalized.taskStates).size !== normalized.taskStates.length) {
    errors.taskStates = "Task states must be unique.";
  }

  return errors;
}

export function workspacePreferencesEqual(
  left: WorkspacePreferences,
  right: WorkspacePreferences,
) {
  return JSON.stringify(normalizeWorkspacePreferences(left)) ===
    JSON.stringify(normalizeWorkspacePreferences(right));
}

function normalizeFolderPath(path: string) {
  return path.trim().replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
}

function isValidFolderPath(path: string, rejectManagedFolders = false) {
  return path.split("/").every((segment) => {
    if (!segment || segment === "." || segment === ".." || segment.trim() !== segment) {
      return false;
    }
    return (
      !rejectManagedFolders ||
      ![".git", "node_modules", "target"].includes(segment.toLocaleLowerCase())
    );
  });
}

function hasAbsolutePrefix(path: string) {
  const trimmed = path.trim();
  return trimmed.startsWith("/") || trimmed.startsWith("\\") || /^[A-Za-z]:/.test(trimmed);
}

function foldersOverlap(left: string, right: string) {
  const normalizedLeft = left.toLocaleLowerCase();
  const normalizedRight = right.toLocaleLowerCase();
  return (
    normalizedLeft === normalizedRight ||
    normalizedLeft.startsWith(`${normalizedRight}/`) ||
    normalizedRight.startsWith(`${normalizedLeft}/`)
  );
}
