/**
 * Shared close path for workspace switches, menu actions, and application exit.
 * Cryptomator-specific process handling remains behind the backend command.
 */

import { confirm, message } from "@tauri-apps/plugin-dialog";
import { get } from "svelte/store";
import { closeWorkspace, exitApplication } from "./api.js";
import { appUndoStore } from "./stores/appUndo.js";
import { editorSessionStore } from "./stores/editorSession.js";
import { mainViewStore } from "./stores/mainView.js";
import { rightPaneStore } from "./stores/rightPane.js";
import { taskStore } from "./stores/tasks.js";
import { workspaceStore } from "./stores/workspace.js";

let closing = false;

export async function closeActiveWorkspace(exitAfterClose = false): Promise<boolean> {
  if (closing) {
    return false;
  }

  const workspace = get(workspaceStore);
  if (!workspace.root) {
    if (workspace.loading) {
      await message("Wait for the workspace to finish opening before closing Logtext.", {
        title: "Workspace is opening",
        kind: "warning",
      });
      return false;
    }
    if (exitAfterClose) {
      await finishBackendWorkspaceClose();
      await exitApplication();
    }
    return true;
  }

  closing = true;
  try {
    if (!(await prepareEditorForClose(workspace.disconnected))) {
      return false;
    }

    const editor = get(editorSessionStore);
    const rightPane = get(rightPaneStore);
    if (!workspace.disconnected) {
      const sessionSaved = await workspaceStore.saveWorkspaceSession(editor.path, rightPane.path);
      if (!sessionSaved) {
        return false;
      }
    }

    await finishBackendWorkspaceClose();

    clearWorkspaceUi(workspace.source === "cryptomator" ? workspace.vaultPath : null);
    if (exitAfterClose) {
      await exitApplication();
    }
    return true;
  } finally {
    closing = false;
  }
}

/** Completes cleanup retained by the backend after a post-mount open failure. */
export async function closeFailedCryptomatorOpen(): Promise<void> {
  if (closing) {
    return;
  }
  closing = true;
  try {
    await finishBackendWorkspaceClose();
  } finally {
    closing = false;
  }
}

export function clearWorkspaceUi(lockedVaultPath: string | null = null) {
  editorSessionStore.clear();
  rightPaneStore.clear();
  workspaceStore.clear(lockedVaultPath);
  taskStore.clear();
  appUndoStore.clear();
  mainViewStore.set("editor");
}

async function prepareEditorForClose(disconnected: boolean): Promise<boolean> {
  if (!(await waitForEditorSave())) {
    await message("Wait for the current save to finish before closing the workspace.", {
      title: "Logtext",
      kind: "warning",
    });
    return false;
  }

  let editor = get(editorSessionStore);
  if (!editor.dirty && !editor.conflict) {
    return true;
  }

  if (disconnected) {
    return confirm(
      "The Cryptomator vault is no longer mounted, so these editor changes cannot be saved. Copy any content you need before discarding it.",
      {
        title: "Discard disconnected editor changes?",
        kind: "warning",
        okLabel: "Discard and close",
        cancelLabel: "Cancel",
      },
    );
  }

  if (!editor.conflict) {
    const save = await confirm("Save editor changes before closing the workspace?", {
      title: "Unsaved editor changes",
      kind: "warning",
      okLabel: "Save and close",
      cancelLabel: "Other options",
    });
    if (save) {
      await editorSessionStore.save();
      editor = get(editorSessionStore);
      return !editor.dirty && !editor.conflict && !editor.saving && !editor.error;
    }
  }

  return confirm("Close the workspace and discard the unsaved editor changes?", {
    title: "Discard editor changes?",
    kind: "warning",
    okLabel: "Discard and close",
    cancelLabel: "Cancel",
  });
}

async function finishBackendWorkspaceClose(): Promise<void> {
  let result = await closeWorkspace(false);
  while (result.status === "timedOut") {
    const force = await confirm(
      `Cryptomator is still closing. Force the process to stop? The vault may require manual unmounting.\n\n${result.detail}`,
      {
        title: "Cryptomator is still closing",
        kind: "warning",
        okLabel: "Force stop",
        cancelLabel: "Wait another 30 seconds",
      },
    );
    result = await closeWorkspace(force);
  }

  if (result.status === "unmountFailed") {
    await message(
      `Logtext could not confirm a clean unmount. Check the mounted volumes before assuming the vault is locked.\n\n${result.detail}`,
      {
        title: "Cryptomator unmount incomplete",
        kind: "warning",
      },
    );
  }
}

async function waitForEditorSave(timeoutMs = 10_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (get(editorSessionStore).saving && Date.now() < deadline) {
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }
  return !get(editorSessionStore).saving;
}
