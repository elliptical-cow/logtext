import { openPage, savePage } from "../api.js";
import { createEditorSessionStore } from "./createEditorSessionStore.js";
import { rightPaneStore } from "./rightPane.js";
import { workspaceStore } from "./workspace.js";
import { pageContentUpdateStore } from "./pageContentUpdates.js";

export const editorSessionStore = createEditorSessionStore({
  openPage,
  savePage,
  refreshPages: () => workspaceStore.refreshPages(),
  refreshRightPane: () => rightPaneStore.refresh(),
  notifyPageChanged: (path) => pageContentUpdateStore.notify(path),
  autoSaveDelayMs: 3000,
});
