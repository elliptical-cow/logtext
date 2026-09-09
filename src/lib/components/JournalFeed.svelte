<script lang="ts">
  import { onDestroy, tick } from "svelte";
  import { getPageView } from "../api";
  import {
    expandJournalFeedWindow,
    initialJournalFeedWindow,
    orderedJournalPaths,
  } from "../journals";
  import { toErrorMessage } from "../errors";
  import type {
    BacklinkView,
    FolderColors,
    PageSummary,
    PageView,
    TaskStateColors,
  } from "../types";
  import type { LinkTargetPane } from "../stores/linkOperations";
  import { pageContentUpdateStore } from "../stores/pageContentUpdates";
  import LinkedReferences from "./LinkedReferences.svelte";
  import MarkdownView from "./MarkdownView.svelte";

  export let anchorPath: string;
  export let anchorView: PageView;
  export let pages: PageSummary[] = [];
  export let journalFolder: string;
  export let sortDescending = false;
  export let taskStates: string[] = [];
  export let taskStateColors: TaskStateColors = {};
  export let folderColors: FolderColors = {};
  export let openTasksOnly = false;
  export let highlightedLine: number | null = null;
  export let highlightToken = 0;
  export let onActivePathChange: (path: string) => void = () => {};
  export let onWikiLink: (target: string, pane: LinkTargetPane) => void = () => {};
  export let onMissingWikiLink: (path: string) => void = () => {};
  export let onCheckboxToggle: (
    path: string,
    line: number,
    checked: boolean,
  ) => Promise<boolean> = async () => false;
  export let onOpenSourceLineInEditor: (path: string, line: number) => void = () => {};
  export let onOpenBacklinkInEditor: (backlink: BacklinkView) => void = () => {};
  export let onOpenBacklinkLineInEditor: (backlink: BacklinkView, line: number) => void = () => {};
  export let onTaskStatusChange: (
    path: string,
    line: number,
    currentStatus: string,
    nextStatus: string,
  ) => Promise<boolean> = async () => false;
  export let onTaskPriorityChange: (
    path: string,
    line: number,
    currentPriority: string | null,
    nextPriority: string | null,
  ) => Promise<boolean> = async () => false;
  export let onOpenTasksOnlyChange: (openTasksOnly: boolean) => void = () => {};
  export let onError: (message: string | null) => void = () => {};

  const INITIAL_RADIUS = 2;
  const LOAD_BATCH_SIZE = 2;
  const LOAD_THRESHOLD = 240;

  let scrollContainer: HTMLDivElement;
  let views: PageView[] = [];
  let orderedPaths: string[] = [];
  let startIndex = 0;
  let endIndex = -1;
  let loadingBefore = false;
  let loadingAfter = false;
  let initializationKey = "";
  let requestSequence = 0;
  let activePath = "";
  let lastAnchorView: PageView | null = null;
  let handledPageRevision = 0;
  let destroyed = false;

  $: nextInitializationKey = [
    anchorPath,
    journalFolder,
    sortDescending ? "desc" : "asc",
    pages.map((page) => page.path).join("\u0000"),
  ].join("\u0001");
  $: if (nextInitializationKey !== initializationKey) {
    initializationKey = nextInitializationKey;
    void initializeFeed();
  }
  $: if (anchorView !== lastAnchorView) {
    lastAnchorView = anchorView;
    if (anchorView.page.path === anchorPath) {
      const index = views.findIndex((view) => view.page.path === anchorPath);
      if (index >= 0) {
        views[index] = anchorView;
        views = views;
      }
    }
  }
  $: if ($pageContentUpdateStore && $pageContentUpdateStore.revision > handledPageRevision) {
    handledPageRevision = $pageContentUpdateStore.revision;
    if (views.some((view) => view.page.path === $pageContentUpdateStore?.path)) {
      void refreshPath($pageContentUpdateStore.path);
    }
  }

  onDestroy(() => {
    destroyed = true;
    requestSequence += 1;
  });

  async function initializeFeed() {
    const requestId = ++requestSequence;
    onError(null);
    loadingBefore = false;
    loadingAfter = false;
    views = anchorView.page.path === anchorPath ? [anchorView] : [];
    activePath = anchorPath;
    onActivePathChange(anchorPath);
    orderedPaths = orderedJournalPaths(
      pages.map((page) => page.path),
      journalFolder,
      sortDescending ? "desc" : "asc",
    );
    const anchorIndex = orderedPaths.indexOf(anchorPath);
    if (anchorIndex < 0) {
      const loaded = await loadViews([anchorPath], requestId);
      if (destroyed || requestId !== requestSequence) {
        return;
      }
      views = loaded;
      startIndex = 0;
      endIndex = 0;
      await tick();
      scrollAnchorIntoView();
      return;
    }

    const initialWindow = initialJournalFeedWindow(
      anchorIndex,
      orderedPaths.length,
      INITIAL_RADIUS,
    );
    startIndex = initialWindow.start;
    endIndex = initialWindow.end;
    const initialPaths = orderedPaths.slice(startIndex, endIndex + 1);
    const loaded = await loadViews(initialPaths, requestId);
    if (destroyed || requestId !== requestSequence) {
      return;
    }
    views = loaded;
    await tick();
    scrollAnchorIntoView();
  }

  async function loadViews(paths: string[], requestId: number) {
    const loaded = await Promise.all(
      paths.map(async (path) => {
        if (path === anchorPath && anchorView.page.path === anchorPath) {
          return anchorView;
        }
        try {
          return await getPageView(path);
        } catch (error) {
          if (requestId === requestSequence) {
            onError(`Could not load journal page '${path}': ${toErrorMessage(error)}`);
          }
          return null;
        }
      }),
    );
    return loaded.filter((view): view is PageView => view !== null);
  }

  function scrollAnchorIntoView() {
    const element = journalElements().find((entry) => entry.dataset.journalPath === anchorPath);
    if (element) {
      scrollContainer.scrollTop +=
        element.getBoundingClientRect().top - scrollContainer.getBoundingClientRect().top;
    }
    updateActivePath();
  }

  function handleScroll() {
    updateActivePath();
    if (scrollContainer.scrollTop <= LOAD_THRESHOLD) {
      void loadBefore();
    }
    if (
      scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight <=
      LOAD_THRESHOLD
    ) {
      void loadAfter();
    }
  }

  function updateActivePath() {
    if (!scrollContainer) {
      return;
    }
    const referenceTop =
      scrollContainer.getBoundingClientRect().top + Math.min(120, scrollContainer.clientHeight / 3);
    let nextActive = views[0]?.page.path ?? anchorPath;
    for (const element of journalElements()) {
      if (element.getBoundingClientRect().top <= referenceTop) {
        nextActive = element.dataset.journalPath ?? nextActive;
      } else {
        break;
      }
    }
    if (nextActive !== activePath) {
      activePath = nextActive;
      onActivePathChange(nextActive);
    }
  }

  async function loadBefore() {
    if (loadingBefore || startIndex <= 0) {
      return;
    }
    loadingBefore = true;
    const requestId = requestSequence;
    const nextStart = expandJournalFeedWindow(
      { start: startIndex, end: endIndex },
      orderedPaths.length,
      "before",
      LOAD_BATCH_SIZE,
    ).start;
    const paths = orderedPaths.slice(nextStart, startIndex);
    const previousHeight = scrollContainer.scrollHeight;
    const loaded = await loadViews(paths, requestId);
    if (!destroyed && requestId === requestSequence) {
      views = [...loaded, ...views];
      startIndex = nextStart;
      await tick();
      scrollContainer.scrollTop += scrollContainer.scrollHeight - previousHeight;
    }
    if (requestId === requestSequence) {
      loadingBefore = false;
    }
  }

  async function loadAfter() {
    if (loadingAfter || endIndex >= orderedPaths.length - 1) {
      return;
    }
    loadingAfter = true;
    const requestId = requestSequence;
    const nextEnd = expandJournalFeedWindow(
      { start: startIndex, end: endIndex },
      orderedPaths.length,
      "after",
      LOAD_BATCH_SIZE,
    ).end;
    const paths = orderedPaths.slice(endIndex + 1, nextEnd + 1);
    const loaded = await loadViews(paths, requestId);
    if (!destroyed && requestId === requestSequence) {
      views = [...views, ...loaded];
      endIndex = nextEnd;
      await tick();
    }
    if (requestId === requestSequence) {
      loadingAfter = false;
    }
  }

  function journalElements() {
    if (!scrollContainer) {
      return [];
    }
    return Array.from(
      scrollContainer.querySelectorAll<HTMLElement>(".journal-feed-document"),
    );
  }

  async function refreshPath(path: string) {
    try {
      const pageView = await getPageView(path);
      const index = views.findIndex((view) => view.page.path === path);
      if (index >= 0) {
        views[index] = pageView;
        views = views;
      }
    } catch (error) {
      onError(`Could not refresh journal page '${path}': ${toErrorMessage(error)}`);
    }
  }

  async function toggleCheckbox(path: string, line: number, checked: boolean) {
    if (await onCheckboxToggle(path, line, checked)) {
      await refreshPath(path);
    }
  }

  async function changeTaskStatus(
    path: string,
    line: number,
    currentStatus: string,
    nextStatus: string,
  ) {
    if (await onTaskStatusChange(path, line, currentStatus, nextStatus)) {
      await refreshPath(path);
    }
  }

  async function changeTaskPriority(
    path: string,
    line: number,
    currentPriority: string | null,
    nextPriority: string | null,
  ) {
    if (await onTaskPriorityChange(path, line, currentPriority, nextPriority)) {
      await refreshPath(path);
    }
  }
</script>

<div class="right-pane-scroll journal-feed" bind:this={scrollContainer} on:scroll={handleScroll}>
  {#if loadingBefore}
    <div class="journal-feed-status">Loading earlier journal pages</div>
  {/if}
  {#each views as pageView (pageView.page.path)}
    <section class="journal-feed-document" data-journal-path={pageView.page.path}>
      <header class="journal-feed-document-header">{pageView.page.path}</header>
      <article class="preview-content">
        <MarkdownView
          content={pageView.content}
          sourcePath={pageView.page.path}
          {pages}
          {taskStates}
          {taskStateColors}
          {folderColors}
          highlightedLine={pageView.page.path === anchorPath ? highlightedLine : null}
          {highlightToken}
          onWikiLink={(target) => onWikiLink(target, "right")}
          {onMissingWikiLink}
          onCheckboxToggle={(line, checked) =>
            void toggleCheckbox(pageView.page.path, line, checked)}
          onOpenWikiLink={onWikiLink}
          onOpenSourceLineInEditor={(line) =>
            onOpenSourceLineInEditor(pageView.page.path, line)}
          sourceLineMenuTargets={["editor"]}
          enableTaskContextMenu
          onTaskStatusChange={(line, currentStatus, nextStatus) =>
            void changeTaskStatus(pageView.page.path, line, currentStatus, nextStatus)}
          onTaskPriorityChange={(line, currentPriority, nextPriority) =>
            void changeTaskPriority(pageView.page.path, line, currentPriority, nextPriority)}
        />
      </article>

      {#if pageView.backlinks.length > 0}
        <LinkedReferences
          backlinks={pageView.backlinks}
          {pages}
          {taskStates}
          {taskStateColors}
          {folderColors}
          {openTasksOnly}
          onOpenTasksOnlyChange={onOpenTasksOnlyChange}
          onWikiLink={(target) => onWikiLink(target, "right")}
          {onMissingWikiLink}
          onOpenWikiLink={onWikiLink}
          onOpenSourceInEditor={onOpenBacklinkInEditor}
          onOpenSourceLineInEditor={onOpenBacklinkLineInEditor}
          sourceLineMenuTargets={["editor"]}
          enableTaskContextMenu
          onCheckboxToggle={(path, line, checked) => void toggleCheckbox(path, line, checked)}
          onTaskStatusChange={(path, line, currentStatus, nextStatus) =>
            void changeTaskStatus(path, line, currentStatus, nextStatus)}
          onTaskPriorityChange={(path, line, currentPriority, nextPriority) =>
            void changeTaskPriority(path, line, currentPriority, nextPriority)}
        />
      {/if}
    </section>
  {/each}
  {#if loadingAfter}
    <div class="journal-feed-status">Loading later journal pages</div>
  {/if}
</div>
