import { get } from "svelte/store";
import { toggleCheckbox, updateTaskPriority, updateTaskStatus } from "../api.js";
import { toErrorMessage } from "../errors.js";
import { playTaskDoneSound } from "../taskCompletionSound.js";
import {
  statusChangedAtTimestamp,
  type TaskStatusContentChange,
} from "../taskStatusChanges.js";
import type {
  ToggleCheckboxResult,
  UpdateTaskPriorityResult,
  UpdateTaskStatusResult,
} from "../types.js";
import {
  appUndoStore,
  type AppUndoMutationOperation,
} from "./appUndo.js";
import { editorSessionStore } from "./editorSession.js";
import { rightPaneStore } from "./rightPane.js";
import { taskStore } from "./tasks.js";
import { workspaceStore } from "./workspace.js";

type MutationEditorState = {
  path: string | null;
  dirty: boolean;
  saving: boolean;
  conflict: boolean;
  error: string | null;
};

export type MutationOutcome =
  | { status: "changed"; error: null }
  | { status: "unchanged"; error: null }
  | { status: "failed"; error: string };

export type MutationOperationDependencies = {
  getEditorState: () => MutationEditorState;
  getTaskConfig: () => {
    taskStates: string[];
    taskDoneSoundEnabled: boolean;
  };
  toggleEditorCheckbox: (line: number) => boolean;
  setEditorTaskStatus: (
    line: number,
    currentStatus: string,
    nextStatus: string,
    taskStates: string[],
    changedAt: string,
  ) => TaskStatusContentChange;
  setEditorTaskPriority: (
    line: number,
    priority: string | null,
    taskStates: string[],
  ) => boolean;
  saveEditor: () => Promise<boolean>;
  toggleCheckbox: (path: string, line: number) => Promise<ToggleCheckboxResult>;
  updateTaskStatus: (
    path: string,
    line: number,
    currentStatus: string,
    nextStatus: string,
    changedAt: string,
  ) => Promise<UpdateTaskStatusResult>;
  updateTaskPriority: (
    path: string,
    line: number,
    priority: string | null,
  ) => Promise<UpdateTaskPriorityResult>;
  pushUndo: (operation: AppUndoMutationOperation) => void;
  isolateEditorHistory: () => void;
  refreshTasks: () => Promise<void>;
  refreshRightPane: () => Promise<void>;
  playDoneSound: (nextStatus: string, taskStates: string[], enabled: boolean) => void;
  now: () => Date;
};

const changed: MutationOutcome = { status: "changed", error: null };
const unchanged: MutationOutcome = { status: "unchanged", error: null };

const defaultDependencies: MutationOperationDependencies = {
  getEditorState: () => get(editorSessionStore),
  getTaskConfig: () => {
    const workspace = get(workspaceStore);
    return {
      taskStates: workspace.taskStates,
      taskDoneSoundEnabled: workspace.taskDoneSoundEnabled,
    };
  },
  toggleEditorCheckbox: (line) => editorSessionStore.toggleCheckboxLine(line),
  setEditorTaskStatus: (line, currentStatus, nextStatus, taskStates, changedAt) =>
    editorSessionStore.setTaskStatusLine(
      line,
      currentStatus,
      nextStatus,
      taskStates,
      changedAt,
    ),
  setEditorTaskPriority: (line, priority, taskStates) =>
    editorSessionStore.setTaskPriorityLine(line, priority, taskStates),
  saveEditor: () => editorSessionStore.save(),
  toggleCheckbox,
  updateTaskStatus,
  updateTaskPriority,
  pushUndo: (operation) => appUndoStore.push(operation),
  isolateEditorHistory: () => {
    window.dispatchEvent(new CustomEvent("logtext-editor-isolate-history"));
  },
  refreshTasks: () => taskStore.refresh(),
  refreshRightPane: () => rightPaneStore.refresh(),
  playDoneSound: playTaskDoneSound,
  now: () => new Date(),
};

export function createMutationOperations(
  dependencies: MutationOperationDependencies = defaultDependencies,
) {
  const activePaths = new Set<string>();

  return {
    async toggleCheckbox(
      path: string | null,
      line: number,
      previousChecked: boolean,
    ): Promise<MutationOutcome> {
      if (!path) {
        return unchanged;
      }

      const guard = editorGuard(dependencies.getEditorState(), path, "changing this checkbox");
      if (guard) {
        return guard;
      }
      const mutationKey = beginFileMutation(activePaths, path);
      if (!mutationKey) {
        return failed(
          "Wait for the current file change to finish before changing this checkbox.",
        );
      }

      dependencies.isolateEditorHistory();
      try {
        const editor = dependencies.getEditorState();
        if (editor.path === path) {
          if (!dependencies.toggleEditorCheckbox(line)) {
            return failed(`Line ${line} is not a recognized checkbox item.`);
          }
          if (!(await dependencies.saveEditor())) {
            return failed(
              dependencies.getEditorState().error ?? "Checkbox change could not be saved.",
            );
          }
          dependencies.pushUndo({
            kind: "checkbox",
            path,
            line,
            beforeChecked: previousChecked,
            afterChecked: !previousChecked,
          });
        } else {
          const result = await dependencies.toggleCheckbox(path, line);
          dependencies.pushUndo({
            kind: "checkbox",
            path: result.path,
            line: result.line,
            beforeChecked: previousChecked,
            afterChecked: result.checked,
          });
        }

        await refreshDerivedViews(dependencies);
        return changed;
      } catch (error) {
        return failed(`Could not change checkbox: ${toErrorMessage(error)}`);
      } finally {
        activePaths.delete(mutationKey);
        dependencies.isolateEditorHistory();
      }
    },

    async setTaskStatus(
      path: string | null,
      line: number,
      currentStatus: string,
      nextStatus: string,
    ): Promise<MutationOutcome> {
      if (!path || !nextStatus || currentStatus === nextStatus) {
        return unchanged;
      }

      const guard = editorGuard(dependencies.getEditorState(), path, "changing this task status");
      if (guard) {
        return guard;
      }
      const mutationKey = beginFileMutation(activePaths, path);
      if (!mutationKey) {
        return failed(
          "Wait for the current file change to finish before changing this task status.",
        );
      }

      const { taskStates, taskDoneSoundEnabled } = dependencies.getTaskConfig();
      const changedAt = statusChangedAtTimestamp(dependencies.now());

      dependencies.isolateEditorHistory();
      try {
        const editor = dependencies.getEditorState();
        let operationPath = path;
        let operationLine = line;
        let beforeStatusChangedAtSource: string | null = null;
        let afterStatusChangedAtSource = "";
        if (editor.path === path) {
          const editorChange = dependencies.setEditorTaskStatus(
            line,
            currentStatus,
            nextStatus,
            taskStates,
            changedAt,
          );
          if (!editorChange.changed) {
            return failed(`Line ${line} is not a recognized task. Refresh tasks.`);
          }
          if (!(await dependencies.saveEditor())) {
            return failed(
              dependencies.getEditorState().error ?? "Task status could not be saved.",
            );
          }
          beforeStatusChangedAtSource = editorChange.previousStatusChangedAtSource;
          afterStatusChangedAtSource = editorChange.statusChangedAtSource ?? "";
        } else {
          const result = await dependencies.updateTaskStatus(
            path,
            line,
            currentStatus,
            nextStatus,
            changedAt,
          );
          operationPath = result.task.path;
          operationLine = result.task.line;
          beforeStatusChangedAtSource = result.previousStatusChangedAtSource;
          afterStatusChangedAtSource = result.statusChangedAtSource;
        }

        dependencies.pushUndo({
          kind: "task-status",
          path: operationPath,
          line: operationLine,
          beforeStatus: currentStatus,
          afterStatus: nextStatus,
          beforeStatusChangedAtSource,
          afterStatusChangedAtSource,
        });
        dependencies.playDoneSound(nextStatus, taskStates, taskDoneSoundEnabled);
        await refreshDerivedViews(dependencies);
        return changed;
      } catch (error) {
        return failed(`Could not change task status: ${toErrorMessage(error)}`);
      } finally {
        activePaths.delete(mutationKey);
        dependencies.isolateEditorHistory();
      }
    },

    async setTaskPriority(
      path: string | null,
      line: number,
      currentPriority: string | null,
      nextPriority: string | null,
    ): Promise<MutationOutcome> {
      if (!path || currentPriority === nextPriority) {
        return unchanged;
      }

      const guard = editorGuard(dependencies.getEditorState(), path, "changing this task priority");
      if (guard) {
        return guard;
      }
      const mutationKey = beginFileMutation(activePaths, path);
      if (!mutationKey) {
        return failed(
          "Wait for the current file change to finish before changing this task priority.",
        );
      }

      const { taskStates } = dependencies.getTaskConfig();

      dependencies.isolateEditorHistory();
      try {
        const editor = dependencies.getEditorState();
        let operationPath = path;
        let operationLine = line;
        if (editor.path === path) {
          if (!dependencies.setEditorTaskPriority(line, nextPriority, taskStates)) {
            return failed(`Line ${line} is not a recognized task. Refresh tasks.`);
          }
          if (!(await dependencies.saveEditor())) {
            return failed(
              dependencies.getEditorState().error ?? "Task priority could not be saved.",
            );
          }
        } else {
          const result = await dependencies.updateTaskPriority(path, line, nextPriority);
          operationPath = result.task.path;
          operationLine = result.task.line;
        }

        dependencies.pushUndo({
          kind: "task-priority",
          path: operationPath,
          line: operationLine,
          beforePriority: currentPriority,
          afterPriority: nextPriority,
        });
        await refreshDerivedViews(dependencies);
        return changed;
      } catch (error) {
        return failed(`Could not change task priority: ${toErrorMessage(error)}`);
      } finally {
        activePaths.delete(mutationKey);
        dependencies.isolateEditorHistory();
      }
    },
  };
}

function beginFileMutation(activePaths: Set<string>, path: string) {
  const key = path.replaceAll("\\", "/").toLowerCase();
  if (activePaths.has(key)) {
    return null;
  }
  activePaths.add(key);
  return key;
}

function editorGuard(
  editor: MutationEditorState,
  path: string,
  action: string,
): MutationOutcome | null {
  if (
    editor.path !== path ||
    (!editor.saving && !editor.conflict)
  ) {
    return null;
  }

  return failed(`Wait for the current save or resolve the editor conflict before ${action}.`);
}

async function refreshDerivedViews(dependencies: MutationOperationDependencies) {
  await dependencies.refreshTasks();
  await dependencies.refreshRightPane();
}

function failed(error: string): MutationOutcome {
  return { status: "failed", error };
}

export const mutationOperations = createMutationOperations();
