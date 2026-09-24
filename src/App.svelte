<script lang="ts">
  import { getVersion } from "@tauri-apps/api/app";
  import { onDestroy, onMount } from "svelte";
  import { get } from "svelte/store";
  import CommandPalette from "./lib/components/CommandPalette.svelte";
  import EditorPane from "./lib/components/EditorPane.svelte";
  import ErrorDialog from "./lib/components/ErrorDialog.svelte";
  import FileTree from "./lib/components/FileTree.svelte";
  import MediaCleanupDialog from "./lib/components/MediaCleanupDialog.svelte";
  import PaneVisibilityButton from "./lib/components/PaneVisibilityButton.svelte";
  import PreferencesDialog from "./lib/components/PreferencesDialog.svelte";
  import RightPane from "./lib/components/RightPane.svelte";
  import TaskOverview from "./lib/components/TaskOverview.svelte";
  import { listUnusedMedia, moveUnusedMediaToTrash, setWindowTitle } from "./lib/api";
  import {
    commandDefinitions,
    commandForKeyboardEvent,
    type CommandId,
  } from "./lib/appCommands";
  import { setupCoreEvents } from "./lib/coreEvents";
  import { trapDialogFocus } from "./lib/dialogFocus";
  import {
    activeFocusRegion,
    cycleFocusRegion,
    focusRegion,
    focusWorkspaceRegion,
  } from "./lib/focusRegions";
  import { journalPath } from "./lib/journals";
  import { keyboardShortcuts } from "./lib/keyboardShortcuts";
  import {
    isPaneVisible,
    paneGridTemplate,
    withPaneVisibility,
    type WorkspacePane,
  } from "./lib/paneLayout";
  import { appErrorStore, runUserAction } from "./lib/stores/appErrors";
  import { editorSessionStore } from "./lib/stores/editorSession";
  import { editorModeStore } from "./lib/stores/editorMode";
  import { linkOperations } from "./lib/stores/linkOperations";
  import { mainViewStore } from "./lib/stores/mainView";
  import { rightPaneStore } from "./lib/stores/rightPane";
  import { taskStore } from "./lib/stores/tasks";
  import { themeStore } from "./lib/stores/theme";
  import { workspaceStore } from "./lib/stores/workspace";
  import { zoomStore } from "./lib/stores/zoom";
  import type { MediaCleanupCandidate, WorkspacePreferences } from "./lib/types";
  import { workspacePreferencesFromState } from "./lib/workspacePreferences";

  const layoutStorageKey = "logtext:layout:columns";
  const defaultLeftWidth = 280;
  const defaultRightWidth = 440;
  const minLeftWidth = 220;
  const minEditorWidth = 360;
  const minRightWidth = 280;
  const resizerWidth = 6;
  const collapsedPaneWidth = 32;
  const repositoryUrl = "https://github.com/elliptical-cow/logtext";
  const licenseUrl = `${repositoryUrl}/blob/main/LICENSE`;
  let leftWidth = defaultLeftWidth;
  let rightWidth = defaultRightWidth;
  let activeResize: "left" | "right" | null = null;
  let showAbout = false;
  let showKeyboardShortcuts = false;
  let showMediaCleanup = false;
  let showPreferences = false;
  let preferences: WorkspacePreferences | null = null;
  let preferencesError: string | null = null;
  let preferencesErrorDetail: string | null = null;
  let mediaCleanupCandidates: MediaCleanupCandidate[] = [];
  let mediaCleanupScanning = false;
  let mediaCleanupMoving = false;
  let mediaCleanupRequest = 0;
  let appVersion = "0.1.0";
  let sessionRestoreRoot: string | null = null;
  let restoringWorkspaceSession = false;
  let lastSavedSessionKey = "";
  let lastWindowTitle = "";
  let sessionSaveTimer: ReturnType<typeof setTimeout> | null = null;
  let isStarting = true;
  let paletteMode: "commands" | "pages" | null = null;
  let navigationCommandAvailable = false;

  onMount(() => {
    void initializeApp();
    loadLayout();
    window.addEventListener("logtext-reset-layout", resetLayout);
    window.addEventListener("logtext-toggle-left-pane", toggleLeftPane);
    window.addEventListener("logtext-toggle-middle-pane", toggleMiddlePane);
    window.addEventListener("logtext-toggle-right-pane", toggleRightPane);
    window.addEventListener("logtext-show-about", openAboutDialog);
    window.addEventListener("logtext-show-keyboard-shortcuts", openKeyboardShortcutsDialog);
    window.addEventListener("logtext-clean-media", handleCleanMediaRequest);
    window.addEventListener("logtext-show-preferences", openPreferencesDialog);
    window.addEventListener("logtext-execute-command", handleExecuteCommandEvent);
    window.addEventListener("logtext-navigation-context", handleNavigationContext);
    window.addEventListener("wheel", handleWheel, { passive: false });
    window.addEventListener("keydown", handleKeyboardCommand, { capture: true });
  });

  async function initializeApp() {
    await Promise.all([
      runUserAction("Could not initialize native application events", setupCoreEvents),
      workspaceStore.openLastWorkspace(),
      loadAppVersion(),
    ]);
    isStarting = false;
  }

  $: gridTemplateColumns = paneGridTemplate($workspaceStore.navigationLayout, {
    leftWidth,
    rightWidth,
    minLeftWidth,
    minMiddleWidth: minEditorWidth,
    minRightWidth,
    resizerWidth,
    collapsedPaneWidth,
  });
  $: if ($workspaceStore.root !== sessionRestoreRoot) {
    sessionRestoreRoot = $workspaceStore.root;
    void restoreWorkspaceSession();
  }
  $: scheduleWorkspaceSessionSave(
    $workspaceStore.root,
    $editorSessionStore.path,
    $rightPaneStore.path,
  );
  $: updateWindowTitle($workspaceStore.root);

  function loadLayout() {
    try {
      const stored = localStorage.getItem(layoutStorageKey);
      const parsed = stored ? JSON.parse(stored) : null;

      if (typeof parsed?.leftWidth === "number") {
        leftWidth = parsed.leftWidth;
      }

      if (typeof parsed?.rightWidth === "number") {
        rightWidth = parsed.rightWidth;
      }

      clampLayout(window.innerWidth);
    } catch {
      clampLayout(window.innerWidth);
    }
  }

  async function loadAppVersion() {
    try {
      appVersion = await getVersion();
    } catch {
      appVersion = "0.1.0";
    }
  }

  function updateWindowTitle(root: string | null) {
    const title = root ? `Logtext: ${root}` : "Logtext";
    if (title === lastWindowTitle) {
      return;
    }

    lastWindowTitle = title;
    void runUserAction("Could not update the application window title", () =>
      setWindowTitle(title),
    );
  }

  function openAboutDialog() {
    showAbout = true;
  }

  function closeAboutDialog() {
    showAbout = false;
  }

  function openKeyboardShortcutsDialog() {
    showKeyboardShortcuts = true;
  }

  function closeKeyboardShortcutsDialog() {
    showKeyboardShortcuts = false;
  }

  function openPalette(mode: "commands" | "pages") {
    paletteMode = mode;
  }

  function closePalette() {
    paletteMode = null;
  }

  function handleKeyboardCommand(event: KeyboardEvent) {
    const command = commandForKeyboardEvent(event);
    if (!command) {
      return;
    }
    const modal = event.target instanceof HTMLElement
      ? event.target.closest("[aria-modal='true']")
      : null;
    if (modal && command.id !== "app.quickOpen" && command.id !== "app.commandPalette") {
      return;
    }
    if (command.requiresWorkspace && !$workspaceStore.root) {
      return;
    }
    if (
      command.keyBinding?.scope === "editor"
      && !(event.target instanceof HTMLElement && event.target.closest(".cm-editor"))
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    executeCommand(command.id);
  }

  function executeCommand(id: CommandId) {
    if (id !== "app.quickOpen" && id !== "app.commandPalette") {
      closePalette();
    }

    switch (id) {
      case "app.quickOpen":
        openPalette("pages");
        return;
      case "app.commandPalette":
        openPalette("commands");
        return;
      case "workspace.search":
        focusWorkspaceRegion("left");
        window.dispatchEvent(new CustomEvent("logtext-focus-workspace-search"));
        return;
      case "workspace.newPage":
        window.dispatchEvent(new CustomEvent("logtext-new-page", { detail: { folderPath: "" } }));
        return;
      case "workspace.newFolder":
      case "navigation.rename":
      case "navigation.move":
      case "navigation.delete":
        window.dispatchEvent(new CustomEvent("logtext-file-command", { detail: { id } }));
        return;
      case "workspace.today":
        window.dispatchEvent(new CustomEvent("logtext-open-journal", { detail: { day: "today" } }));
        return;
      case "editor.openLineInRightPane":
        window.dispatchEvent(new CustomEvent("logtext-open-editor-line-in-right-pane"));
        return;
      case "view.focusNextPane":
        cycleFocusRegion(1);
        return;
      case "view.focusPreviousPane":
        cycleFocusRegion(-1);
        return;
      case "view.historyBack":
        navigateFocusedPane("back");
        return;
      case "view.historyForward":
        navigateFocusedPane("forward");
        return;
      case "view.toggleTasks":
        if ($mainViewStore === "tasks") {
          mainViewStore.set("editor");
        } else {
          mainViewStore.set("tasks");
          void taskStore.refresh();
        }
        requestAnimationFrame(() => focusWorkspaceRegion("middle"));
        return;
      case "view.toggleEditorMode":
        editorModeStore.toggle();
        return;
      case "view.toggleLeftPane":
        window.dispatchEvent(new CustomEvent("logtext-toggle-left-pane"));
        return;
      case "view.toggleMiddlePane":
        window.dispatchEvent(new CustomEvent("logtext-toggle-middle-pane"));
        return;
      case "view.toggleRightPane":
        window.dispatchEvent(new CustomEvent("logtext-toggle-right-pane"));
        return;
      case "view.toggleTheme":
        void workspaceStore.saveThemeMode(themeStore.toggle());
        return;
      case "view.resetLayout":
        resetLayout();
        return;
      case "workspace.preferences":
        openPreferencesDialog();
        return;
      case "workspace.cleanMedia":
        handleCleanMediaRequest();
        return;
      case "help.shortcuts":
        openKeyboardShortcutsDialog();
        return;
      case "help.about":
        openAboutDialog();
    }
  }

  function handleExecuteCommandEvent(event: Event) {
    const id = event instanceof CustomEvent ? event.detail?.id : null;
    if (commandDefinitions.some((command) => command.id === id)) {
      executeCommand(id as CommandId);
    }
  }

  function handleNavigationContext(event: Event) {
    navigationCommandAvailable = event instanceof CustomEvent && Boolean(event.detail?.path);
  }

  function navigateFocusedPane(direction: "back" | "forward") {
    const region = activeFocusRegion();
    if (region === "right") {
      void (direction === "back" ? rightPaneStore.goBack() : rightPaneStore.goForward());
    } else if (region === "middle" && $mainViewStore === "editor") {
      void (direction === "back" ? editorSessionStore.goBack() : editorSessionStore.goForward());
    }
  }

  function openPalettePage(path: string, target: "editor" | "right") {
    closePalette();
    void linkOperations.open(path, target).then(() => {
      requestAnimationFrame(() => focusWorkspaceRegion(target === "editor" ? "middle" : "right"));
    });
  }

  function handleCleanMediaRequest() {
    void runUserAction("Could not search for unused media", openMediaCleanupDialog);
  }

  async function openMediaCleanupDialog() {
    const request = ++mediaCleanupRequest;
    mediaCleanupCandidates = [];
    mediaCleanupScanning = true;
    mediaCleanupMoving = false;
    showMediaCleanup = true;

    try {
      const candidates = await listUnusedMedia();
      if (showMediaCleanup && request === mediaCleanupRequest) {
        mediaCleanupCandidates = candidates;
      }
    } catch (error) {
      if (request === mediaCleanupRequest) {
        showMediaCleanup = false;
        mediaCleanupCandidates = [];
      }
      throw error;
    } finally {
      if (request === mediaCleanupRequest) {
        mediaCleanupScanning = false;
      }
    }
  }

  function closeMediaCleanupDialog() {
    if (mediaCleanupMoving) {
      return;
    }
    mediaCleanupRequest += 1;
    showMediaCleanup = false;
    mediaCleanupScanning = false;
    mediaCleanupCandidates = [];
  }

  function openPreferencesDialog() {
    const workspace = get(workspaceStore);
    if (!workspace.root) {
      return;
    }
    workspaceStore.clearError();
    preferences = workspacePreferencesFromState(workspace);
    preferencesError = null;
    preferencesErrorDetail = null;
    showPreferences = true;
  }

  function closePreferencesDialog() {
    showPreferences = false;
    preferences = null;
    preferencesError = null;
    preferencesErrorDetail = null;
    workspaceStore.clearError();
  }

  async function savePreferences(nextPreferences: WorkspacePreferences) {
    const workspace = get(workspaceStore);
    const taskStatesChanged =
      JSON.stringify(workspace.taskStates) !== JSON.stringify(nextPreferences.taskStates);

    if (taskStatesChanged) {
      let editor = get(editorSessionStore);
      if (editor.saving || editor.conflict) {
        preferencesError = editor.conflict
          ? "Resolve the current editor conflict before changing task states."
          : "Wait for the current page save to finish before changing task states.";
        return false;
      }
      if (editor.dirty) {
        await editorSessionStore.save();
        editor = get(editorSessionStore);
        if (editor.dirty || editor.conflict || editor.saving) {
          preferencesError = "Save the current page successfully before changing task states.";
          return false;
        }
      }
    }

    preferencesError = null;
    preferencesErrorDetail = null;
    const saved = await workspaceStore.savePreferences(nextPreferences);
    if (!saved) {
      const failed = get(workspaceStore);
      preferencesError = failed.error ?? "Could not save workspace preferences.";
      preferencesErrorDetail = failed.errorDetail;
      workspaceStore.clearError();
      return false;
    }

    await Promise.all([taskStore.refresh(), rightPaneStore.refresh()]);
    closePreferencesDialog();
    return true;
  }

  function handleMoveMediaToTrash() {
    void runUserAction("Could not move all unused media to the system trash", async () => {
      mediaCleanupMoving = true;
      try {
        const result = await moveUnusedMediaToTrash(
          mediaCleanupCandidates.map((candidate) => candidate.path),
        );
        const failedPaths = new Set(result.failures.map((failure) => failure.path));
        mediaCleanupCandidates = mediaCleanupCandidates.filter((candidate) =>
          failedPaths.has(candidate.path),
        );

        if (result.failures.length > 0) {
          throw new Error(
            result.failures
              .map((failure) => `${failure.path}: ${failure.message}`)
              .join("\n"),
          );
        }

        showMediaCleanup = false;
        mediaCleanupCandidates = [];
      } finally {
        mediaCleanupMoving = false;
      }
    });
  }

  function persistLayout() {
    localStorage.setItem(layoutStorageKey, JSON.stringify({ leftWidth, rightWidth }));
  }

  function resetColumnWidths() {
    leftWidth = defaultLeftWidth;
    rightWidth = defaultRightWidth;
    clampLayout(window.innerWidth);
    persistLayout();
  }

  function resetLayout() {
    const workspace = get(workspaceStore);
    const restoredNavigationLayout = {
      ...workspace.navigationLayout,
      leftPaneVisible: true,
      middlePaneVisible: true,
      rightPaneVisible: true,
    };
    leftWidth = defaultLeftWidth;
    rightWidth = defaultRightWidth;
    clampLayout(window.innerWidth, restoredNavigationLayout);
    persistLayout();
    if (!workspace.root) {
      return;
    }
    void workspaceStore.saveNavigationLayoutConfig(restoredNavigationLayout);
  }

  function toggleLeftPane(event: Event) {
    void togglePane("left", shouldFocusPaneControl(event));
  }

  function toggleMiddlePane(event: Event) {
    void togglePane("middle", shouldFocusPaneControl(event));
  }

  function toggleRightPane(event: Event) {
    void togglePane("right", shouldFocusPaneControl(event));
  }

  function shouldFocusPaneControl(event: Event) {
    return event instanceof CustomEvent && event.detail?.focusPaneControl === true;
  }

  async function togglePane(pane: WorkspacePane, focusPaneControl: boolean) {
    const workspace = get(workspaceStore);
    if (!workspace.root) {
      return;
    }
    const currentVisible = isPaneVisible(workspace.navigationLayout, pane);
    const saved = await workspaceStore.saveNavigationLayoutConfig(
      withPaneVisibility(workspace.navigationLayout, pane, !currentVisible),
    );
    if (saved && !currentVisible) {
      clampLayout(window.innerWidth, saved);
    }
    if (saved && focusPaneControl) {
      window.requestAnimationFrame(() => {
        document
          .querySelector<HTMLButtonElement>(
            `[data-pane-visibility-control="${pane}"][data-pane-expanded="${!currentVisible}"]`,
          )
          ?.focus();
      });
    }
  }

  function clampLayout(totalWidth: number, navigationLayout = get(workspaceStore).navigationLayout) {
    const { leftPaneVisible, middlePaneVisible, rightPaneVisible } = navigationLayout;
    if (!middlePaneVisible && !rightPaneVisible) {
      return;
    }

    if (middlePaneVisible && rightPaneVisible) {
      const minimumLeftColumnWidth = leftPaneVisible ? minLeftWidth : collapsedPaneWidth;
      const available = Math.max(
        totalWidth - resizerWidth * 2,
        minimumLeftColumnWidth + minEditorWidth + minRightWidth,
      );
      if (leftPaneVisible) {
        leftWidth = Math.max(
          minLeftWidth,
          Math.min(leftWidth, available - minEditorWidth - minRightWidth),
        );
      }
      rightWidth = Math.max(
        minRightWidth,
        Math.min(
          rightWidth,
          available - minEditorWidth - (leftPaneVisible ? leftWidth : collapsedPaneWidth),
        ),
      );
      return;
    }

    if (!leftPaneVisible) {
      return;
    }

    const contentMinWidth = middlePaneVisible ? minEditorWidth : minRightWidth;
    const available = Math.max(
      totalWidth - resizerWidth,
      minLeftWidth + contentMinWidth,
    );
    leftWidth = Math.max(minLeftWidth, Math.min(leftWidth, available - contentMinWidth));
  }

  function startResize(target: "left" | "right", event: PointerEvent) {
    activeResize = target;
    event.preventDefault();
    window.addEventListener("pointermove", resizeColumns);
    window.addEventListener("pointerup", stopResize, { once: true });
  }

  function resizeColumns(event: PointerEvent) {
    if (!activeResize) {
      return;
    }

    if (activeResize === "left") {
      leftWidth = event.clientX;
    } else {
      rightWidth = window.innerWidth - event.clientX;
    }

    clampLayout(window.innerWidth);
  }

  function stopResize() {
    activeResize = null;
    window.removeEventListener("pointermove", resizeColumns);
    persistLayout();
  }

  function resizeWithKeyboard(target: "left" | "right", event: KeyboardEvent) {
    if (event.key === "Home") {
      event.preventDefault();
      if (target === "left") leftWidth = defaultLeftWidth;
      else rightWidth = defaultRightWidth;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const step = event.shiftKey ? 48 : 16;
      if (target === "left") {
        leftWidth += event.key === "ArrowLeft" ? -step : step;
      } else {
        rightWidth += event.key === "ArrowLeft" ? step : -step;
      }
    } else {
      return;
    }
    clampLayout(window.innerWidth);
    persistLayout();
  }

  async function restoreWorkspaceSession() {
    clearWorkspaceSessionSaveTimer();
    restoringWorkspaceSession = true;

    try {
      if (!$workspaceStore.root) {
        lastSavedSessionKey = "";
        return;
      }

      const editorPath = await ensureTodayJournalPage();
      const rightPanePath = $workspaceStore.lastRightPanePath;
      lastSavedSessionKey = workspaceSessionKey($workspaceStore.root, editorPath, rightPanePath);

      mainViewStore.set("editor");
      await editorSessionStore.open(editorPath, { recordHistory: false });

      if (rightPanePath) {
        await rightPaneStore.open(rightPanePath, { recordHistory: false });
      }
    } finally {
      restoringWorkspaceSession = false;
    }
  }

  async function ensureTodayJournalPage() {
    const path = journalPath(new Date(), $workspaceStore.journalFolder);
    const existingPage = $workspaceStore.pages.find(
      (page) => page.path.toLocaleLowerCase() === path.toLocaleLowerCase(),
    );

    if (existingPage) {
      return existingPage.path;
    }

    const page = await workspaceStore.createPage(path);
    return page?.path ?? path;
  }

  function scheduleWorkspaceSessionSave(
    root: string | null,
    editorPath: string | null,
    rightPanePath: string | null,
  ) {
    if (!root || restoringWorkspaceSession) {
      return;
    }

    const sessionKey = workspaceSessionKey(root, editorPath, rightPanePath);
    if (sessionKey === lastSavedSessionKey) {
      return;
    }

    clearWorkspaceSessionSaveTimer();
    sessionSaveTimer = setTimeout(() => {
      sessionSaveTimer = null;
      lastSavedSessionKey = sessionKey;
      void workspaceStore.saveWorkspaceSession(editorPath, rightPanePath);
    }, 300);
  }

  function clearWorkspaceSessionSaveTimer() {
    if (sessionSaveTimer) {
      clearTimeout(sessionSaveTimer);
      sessionSaveTimer = null;
    }
  }

  function workspaceSessionKey(
    root: string | null,
    editorPath: string | null,
    rightPanePath: string | null,
  ) {
    return JSON.stringify({ root, editorPath, rightPanePath });
  }

  function handleWheel(event: WheelEvent) {
    if (!event.ctrlKey && !event.metaKey) {
      return;
    }

    event.preventDefault();

    if (event.deltaY < 0) {
      zoomStore.zoomIn();
    } else if (event.deltaY > 0) {
      zoomStore.zoomOut();
    }
  }

  onDestroy(() => {
    clearWorkspaceSessionSaveTimer();
    window.removeEventListener("pointermove", resizeColumns);
    window.removeEventListener("logtext-reset-layout", resetLayout);
    window.removeEventListener("logtext-toggle-left-pane", toggleLeftPane);
    window.removeEventListener("logtext-toggle-middle-pane", toggleMiddlePane);
    window.removeEventListener("logtext-toggle-right-pane", toggleRightPane);
    window.removeEventListener("logtext-show-about", openAboutDialog);
    window.removeEventListener("logtext-show-keyboard-shortcuts", openKeyboardShortcutsDialog);
    window.removeEventListener("logtext-clean-media", handleCleanMediaRequest);
    window.removeEventListener("logtext-show-preferences", openPreferencesDialog);
    window.removeEventListener("logtext-execute-command", handleExecuteCommandEvent);
    window.removeEventListener("logtext-navigation-context", handleNavigationContext);
    window.removeEventListener("wheel", handleWheel);
    window.removeEventListener("keydown", handleKeyboardCommand, { capture: true });
  });
</script>

<svelte:window on:resize={() => clampLayout(window.innerWidth)} />

{#if isStarting || restoringWorkspaceSession}
  <main class="welcome-screen" aria-busy="true" aria-label="Loading Logtext"></main>
{:else}
  <main
    class:resizing={activeResize !== null}
    class="app-shell"
    style:grid-template-columns={gridTemplateColumns}
    style:--app-font-size={`${14 * $zoomStore}px`}
  >
    <section
      class="workspace-pane-slot workspace-pane-slot-left"
      class:workspace-pane-slot-collapsed={!$workspaceStore.navigationLayout.leftPaneVisible}
      aria-label={$workspaceStore.navigationLayout.leftPaneVisible
        ? "Left pane"
        : "Left pane collapsed"}
    >
      <div
        class="workspace-pane-content"
        hidden={!$workspaceStore.navigationLayout.leftPaneVisible}
        tabindex="-1"
        use:focusRegion={"left"}
      >
        <FileTree />
      </div>
      {#if !$workspaceStore.navigationLayout.leftPaneVisible}
        <div class="workspace-pane-rail">
          <PaneVisibilityButton pane="left" expanded={false} />
        </div>
      {/if}
    </section>
    {#if $workspaceStore.navigationLayout.leftPaneVisible &&
    ($workspaceStore.navigationLayout.middlePaneVisible ||
      $workspaceStore.navigationLayout.rightPaneVisible)}
      <!-- svelte-ignore a11y_no_noninteractive_tabindex a11y_no_noninteractive_element_interactions -->
      <div
        class="column-resizer"
        role="separator"
        tabindex="0"
        aria-orientation="vertical"
        aria-label="Resize file tree"
        aria-valuemin={minLeftWidth}
        aria-valuemax={Math.max(minLeftWidth, window.innerWidth - minEditorWidth - minRightWidth - resizerWidth * 2)}
        aria-valuenow={Math.round(leftWidth)}
        title="Drag to resize. Double-click to reset columns."
        on:pointerdown={(event) => startResize("left", event)}
        on:keydown={(event) => resizeWithKeyboard("left", event)}
        on:dblclick={resetColumnWidths}
      ></div>
    {:else}
      <div class="column-resizer column-resizer-inactive" aria-hidden="true"></div>
    {/if}
    <section
      class="workspace-pane-slot"
      class:workspace-pane-slot-collapsed={!$workspaceStore.navigationLayout.middlePaneVisible}
      aria-label={$workspaceStore.navigationLayout.middlePaneVisible
        ? "Middle pane"
        : "Middle pane collapsed"}
    >
      <div
        class="workspace-pane-content"
        hidden={!$workspaceStore.navigationLayout.middlePaneVisible}
        tabindex="-1"
        use:focusRegion={"middle"}
      >
        {#if $mainViewStore === "tasks"}
          <TaskOverview />
        {:else}
          <EditorPane />
        {/if}
      </div>
      {#if !$workspaceStore.navigationLayout.middlePaneVisible}
        <div class="workspace-pane-rail">
          <PaneVisibilityButton pane="middle" expanded={false} />
        </div>
      {/if}
    </section>
    {#if $workspaceStore.navigationLayout.middlePaneVisible &&
    $workspaceStore.navigationLayout.rightPaneVisible}
      <!-- svelte-ignore a11y_no_noninteractive_tabindex a11y_no_noninteractive_element_interactions -->
      <div
        class="column-resizer"
        role="separator"
        tabindex="0"
        aria-orientation="vertical"
        aria-label="Resize right pane"
        aria-valuemin={minRightWidth}
        aria-valuemax={Math.max(minRightWidth, window.innerWidth - minEditorWidth - minLeftWidth - resizerWidth * 2)}
        aria-valuenow={Math.round(rightWidth)}
        title="Drag to resize. Double-click to reset columns."
        on:pointerdown={(event) => startResize("right", event)}
        on:keydown={(event) => resizeWithKeyboard("right", event)}
        on:dblclick={resetColumnWidths}
      ></div>
    {:else}
      <div class="column-resizer column-resizer-inactive" aria-hidden="true"></div>
    {/if}
    <section
      class="workspace-pane-slot"
      class:workspace-pane-slot-collapsed={!$workspaceStore.navigationLayout.rightPaneVisible}
      aria-label={$workspaceStore.navigationLayout.rightPaneVisible
        ? "Right pane"
        : "Right pane collapsed"}
    >
      <div
        class="workspace-pane-content"
        hidden={!$workspaceStore.navigationLayout.rightPaneVisible}
        tabindex="-1"
        use:focusRegion={"right"}
      >
        <RightPane />
      </div>
      {#if !$workspaceStore.navigationLayout.rightPaneVisible}
        <div class="workspace-pane-rail">
          <PaneVisibilityButton pane="right" expanded={false} />
        </div>
      {/if}
    </section>
  </main>
{/if}

{#if paletteMode}
  <CommandPalette
    mode={paletteMode}
    commands={commandDefinitions.filter((command) =>
      (!command.requiresWorkspace || Boolean($workspaceStore.root))
      && (!command.requiresNavigation || navigationCommandAvailable)
      && (!command.requiresEditor || ($mainViewStore === "editor" && Boolean($editorSessionStore.path))))}
    pages={$workspaceStore.pages}
    onClose={closePalette}
    onCommand={executeCommand}
    onPage={openPalettePage}
  />
{/if}

{#if showMediaCleanup}
  <MediaCleanupDialog
    candidates={mediaCleanupCandidates}
    scanning={mediaCleanupScanning}
    moving={mediaCleanupMoving}
    onCancel={closeMediaCleanupDialog}
    onMoveToTrash={handleMoveMediaToTrash}
  />
{/if}

{#if showPreferences && preferences && $workspaceStore.root}
  <PreferencesDialog
    root={$workspaceStore.root}
    folders={$workspaceStore.folders}
    {preferences}
    saveError={preferencesError}
    saveErrorDetail={preferencesErrorDetail}
    onCancel={closePreferencesDialog}
    onSave={savePreferences}
  />
{/if}

<ErrorDialog
  title="Logtext Error"
  message={$appErrorStore.message}
  detail={$appErrorStore.detail}
  onClose={() => appErrorStore.clear()}
/>

{#if showAbout}
  <div
    class="dialog-backdrop"
    role="presentation"
    on:mousedown={(event) => {
      if (event.currentTarget === event.target) {
        closeAboutDialog();
      }
    }}
  >
    <div
      class="about-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="about-dialog-title"
      tabindex="-1"
      use:trapDialogFocus={{ onClose: closeAboutDialog }}
    >
      <header>
        <h2 id="about-dialog-title">Logtext</h2>
        <p>Version {appVersion}</p>
      </header>

      <div class="about-dialog-body">
        <p>A local Markdown-based knowledge workspace for notes and tasks using backlinks as semantic tags.</p>
        <dl>
          <div>
            <dt>Repository</dt>
            <dd>
              <a href={repositoryUrl} target="_blank" rel="noreferrer">
                Source repository
              </a>
            </dd>
          </div>
          <div>
            <dt>License</dt>
            <dd>
              <a href={licenseUrl} target="_blank" rel="noreferrer">
                GNU Affero General Public License v3.0 (AGPL-3.0)
              </a>
            </dd>
          </div>
        </dl>
        <p class="about-disclaimer">
          Logtext is provided as is, without warranty of any kind. To the extent permitted by law,
          the authors are not liable for damages arising from use of the software.
        </p>
      </div>

      <footer>
        <button type="button" class="primary-action" on:click={closeAboutDialog}>Close</button>
      </footer>
    </div>
  </div>
{/if}

{#if showKeyboardShortcuts}
  <div
    class="dialog-backdrop"
    role="presentation"
    on:mousedown={(event) => {
      if (event.currentTarget === event.target) {
        closeKeyboardShortcutsDialog();
      }
    }}
  >
    <div
      class="about-dialog shortcuts-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-dialog-title"
      tabindex="-1"
      use:trapDialogFocus={{ onClose: closeKeyboardShortcutsDialog }}
    >
      <header>
        <h2 id="shortcuts-dialog-title">Keyboard Shortcuts</h2>
        <p>Core editor and workspace shortcuts.</p>
      </header>

      <div class="about-dialog-body">
        <dl class="shortcut-list">
          {#each keyboardShortcuts as shortcut}
            <div>
              <dt><kbd>{shortcut.keys}</kbd></dt>
              <dd>{shortcut.description}</dd>
            </div>
          {/each}
        </dl>
      </div>

      <footer>
        <button type="button" class="primary-action" on:click={closeKeyboardShortcutsDialog}>
          Close
        </button>
      </footer>
    </div>
  </div>
{/if}
