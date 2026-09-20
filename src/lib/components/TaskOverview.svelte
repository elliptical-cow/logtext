<script lang="ts">
  import { onDestroy } from "svelte";
  import ContextMenuShell from "./ContextMenuShell.svelte";
  import ErrorDialog from "./ErrorDialog.svelte";
  import { createMarkdownRenderer } from "../markdownRenderer";
  import { taskColorStyle } from "../taskColors";
  import {
    availableTaskAttributeNames,
    availableTaskLinks,
    comparePriorityValues,
    filterTasks as filterTaskItems,
    groupTasks as groupTaskItems,
    taskAttributeDisplayValue,
  } from "../taskOverview";
  import { linkOperations } from "../stores/linkOperations";
  import { mutationOperations } from "../stores/mutationOperations";
  import { taskStore } from "../stores/tasks";
  import { workspaceStore } from "../stores/workspace";
  import { applyWikiLinkColorStyles, compactPageLabel } from "../wikiLinks";
  import type {
    TaskAttribute,
    TaskAttributeFilterMode,
    TaskItem,
    TaskLink,
    TaskOverviewConfig,
    TaskOverviewGroupMode,
    TaskStatus,
  } from "../types";

  type StatusFilter = "OPEN" | TaskStatus | "ALL";
  type PriorityFilter = "ALL" | "NONE" | string;

  let statusFilter: StatusFilter = "OPEN";
  let priorityFilter: PriorityFilter = "ALL";
  let textFilter = "";
  let linkedPageFilter = "";
  let attributeFilterName = "";
  let attributeFilterMode: TaskAttributeFilterMode = "has";
  let attributeFilterValue = "";
  let groupMode: TaskOverviewGroupMode = "status";
  let groupAttributeName = "";
  let taskOverviewConfigDraft: TaskOverviewConfig;
  let updatingTaskKey: string | null = null;
  let localError: string | null = null;
  let loadedRoot: string | null = null;
  let lastSavedConfigJson = "";
  let saveConfigTimer: ReturnType<typeof setTimeout> | null = null;
  const editablePriorityOptions = ["A", "B", "C"];
  let taskContextMenu: {
    x: number;
    y: number;
    task: TaskItem;
  } | null = null;
  const inlineMarkdown = createMarkdownRenderer({
    breaks: false,
    workspaceImages: true,
    logtextWikiLinks: true,
  });

  function closeErrorDialog() {
    localError = null;
    taskStore.clearError();
  }

  $: doneState = $workspaceStore.taskStates[$workspaceStore.taskStates.length - 1] ?? "DONE";
  $: if ($workspaceStore.root !== loadedRoot) {
    if (saveConfigTimer) {
      clearTimeout(saveConfigTimer);
      saveConfigTimer = null;
    }
    applyTaskOverviewConfig($workspaceStore.taskOverview);
    loadedRoot = $workspaceStore.root;
    lastSavedConfigJson = JSON.stringify(currentTaskOverviewConfig());
  }
  $: availablePriorities = uniquePriorities($taskStore.tasks);
  $: availableLinks = availableTaskLinks($taskStore.tasks);
  $: availableAttributes = availableTaskAttributeNames($taskStore.tasks);
  $: if (
    $taskStore.loaded &&
    statusFilter !== "OPEN" &&
    statusFilter !== "ALL" &&
    !$workspaceStore.taskStates.includes(statusFilter)
  ) {
    statusFilter = "OPEN";
  }
  $: if (
    $taskStore.loaded &&
    priorityFilter !== "ALL" &&
    priorityFilter !== "NONE" &&
    !availablePriorities.includes(priorityFilter)
  ) {
    priorityFilter = "ALL";
  }
  $: if (
    $taskStore.loaded &&
    linkedPageFilter &&
    !availableLinks.some(([identity]) => identity === linkedPageFilter)
  ) {
    linkedPageFilter = "";
  }
  $: if (
    $taskStore.loaded &&
    attributeFilterName &&
    !availableAttributes.some(([name]) => name === attributeFilterName)
  ) {
    attributeFilterName = "";
    attributeFilterValue = "";
  }
  $: if ($taskStore.loaded && groupMode === "attribute") {
    if (availableAttributes.length === 0) {
      groupMode = "status";
      groupAttributeName = "";
    } else if (!availableAttributes.some(([name]) => name === groupAttributeName)) {
      groupAttributeName =
        availableAttributes.find(([name]) => name === attributeFilterName)?.[0] ??
        availableAttributes[0][0];
    }
  }
  $: filteredTasks = filterTaskItems(
    $taskStore.tasks,
    {
      status: statusFilter,
      priority: priorityFilter,
      text: textFilter,
      linkedPage: linkedPageFilter,
      attributeName: attributeFilterName,
      attributeMode: attributeFilterMode,
      attributeValue: attributeFilterValue,
    },
    doneState,
  );
  $: groupedTasks = groupTaskItems(
    filteredTasks,
    groupMode,
    groupAttributeName,
    linkedPageLabel,
  );
  $: taskOverviewConfigDraft = {
    statusFilter,
    priorityFilter,
    textFilter,
    linkedPageFilter,
    attributeFilterName,
    attributeFilterMode,
    attributeFilterValue,
    groupMode,
    groupAttributeName,
  };
  $: if ($workspaceStore.root && loadedRoot === $workspaceStore.root) {
    scheduleTaskOverviewConfigSave(taskOverviewConfigDraft, $workspaceStore.root);
  }

  function uniquePriorities(tasks: TaskItem[]) {
    return [...new Set(tasks.map((task) => task.priority).filter(Boolean) as string[])].sort(
      comparePriorityValues,
    );
  }

  function linkedPageLabel(link: TaskLink) {
    return link.exists && link.resolvedPath
      ? compactPageLabel(link.resolvedPath, $workspaceStore.pages)
      : `Missing: ${link.label || link.target}`;
  }

  function taskKey(task: TaskItem) {
    return `${task.path}:${task.line}`;
  }

  function taskDisplayText(task: TaskItem) {
    let text = task.text.trimStart();

    for (const marker of ["[ ] ", "[x] ", "[X] "]) {
      if (text.startsWith(marker)) {
        text = text.slice(marker.length).trimStart();
        break;
      }
    }

    if (text.startsWith(task.status)) {
      const remaining = text.slice(task.status.length);
      if (!remaining) {
        return "";
      }
      if (/^\s/.test(remaining) || remaining.startsWith("[#")) {
        text = remaining.trimStart();
      }
    }

    if (task.priority && text.startsWith(`[#${task.priority}]`)) {
      text = text.slice(task.priority.length + 3).trimStart();
    }

    return text;
  }

  function taskHeadingContext(task: TaskItem) {
    return task.sourceHeadings.join(" / ");
  }

  function taskParentContext(task: TaskItem) {
    return task.parentBlocks
      .map((block) => taskDisplayText({ ...task, text: block, priority: null }))
      .filter(Boolean)
      .join(" / ");
  }

  function renderTaskText(task: TaskItem) {
    return applyWikiLinkColorStyles(
      inlineMarkdown.renderInline(taskDisplayText(task), {
        sourcePath: task.path,
        pages: $workspaceStore.pages,
      }),
      $workspaceStore.pages,
      $workspaceStore.folderColors,
    );
  }

  function renderAttributeValue(task: TaskItem, attribute: TaskAttribute) {
    return applyWikiLinkColorStyles(
      inlineMarkdown.renderInline(taskAttributeDisplayValue(attribute), {
        sourcePath: task.path,
        pages: $workspaceStore.pages,
      }),
      $workspaceStore.pages,
      $workspaceStore.folderColors,
    );
  }

  function attributeTitle(attribute: TaskAttribute) {
    const origin = attribute.inherited
      ? `Inherited from line ${attribute.line}`
      : `Defined on line ${attribute.line}`;
    return `${origin}. Source value: ${attribute.value || "(empty)"}`;
  }

  function followRenderedLink(event: MouseEvent) {
    const link = (event.target as HTMLElement | null)?.closest<HTMLAnchorElement>("a");
    const href = link?.getAttribute("href");

    if (href?.startsWith("logtext:")) {
      event.preventDefault();
      event.stopPropagation();
      void linkOperations.open(decodeURIComponent(href.slice("logtext:".length)), "right");
      return true;
    }

    if (href?.startsWith("logtext-missing:")) {
      event.preventDefault();
      event.stopPropagation();
      localError = `Linked page does not exist: ${decodeURIComponent(
        href.slice("logtext-missing:".length),
      )}`;
      return true;
    }

    return false;
  }

  function handleTaskMainClick(task: TaskItem, event: MouseEvent) {
    if (followRenderedLink(event)) {
      return;
    }

    openTask(task);
  }

  function handleTaskMainKeydown(task: TaskItem, event: KeyboardEvent) {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    openTask(task);
  }

  function handleTaskChipKeydown(task: TaskItem, event: KeyboardEvent) {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    openTaskContextMenu(task, event);
  }

  async function changeTaskStatus(task: TaskItem, newStatus: string) {
    if (!newStatus || newStatus === task.status) {
      return;
    }

    taskContextMenu = null;
    localError = null;
    updatingTaskKey = taskKey(task);
    const result = await mutationOperations.setTaskStatus(
      task.path,
      task.line,
      task.status,
      newStatus,
    );
    localError = result.error;
    updatingTaskKey = null;
  }

  async function changeTaskPriority(task: TaskItem, nextPriority: string | null) {
    if (nextPriority === task.priority) {
      return;
    }

    taskContextMenu = null;
    localError = null;
    updatingTaskKey = taskKey(task);
    const result = await mutationOperations.setTaskPriority(
      task.path,
      task.line,
      task.priority,
      nextPriority,
    );
    localError = result.error;
    updatingTaskKey = null;
  }

  function openTaskContextMenu(task: TaskItem, event: MouseEvent | KeyboardEvent) {
    event.preventDefault();
    event.stopPropagation();
    const fallbackRect =
      event.currentTarget instanceof HTMLElement
        ? event.currentTarget.getBoundingClientRect()
        : null;
    taskContextMenu = {
      x: event instanceof MouseEvent ? event.clientX : (fallbackRect?.left ?? 0),
      y: event instanceof MouseEvent ? event.clientY : (fallbackRect?.bottom ?? 0),
      task,
    };
  }

  function closeTaskContextMenu() {
    taskContextMenu = null;
  }

  function editTask(task: TaskItem) {
    void linkOperations.open(task.path, "editor", { line: task.line });
  }

  function openTask(task: TaskItem) {
    void linkOperations.open(task.path, "right", { line: task.line });
  }

  function editTaskFromButton(task: TaskItem, event: MouseEvent) {
    event.stopPropagation();
    editTask(task);
  }

  function refreshTasks() {
    void taskStore.refresh();
  }

  function applyTaskOverviewConfig(config: TaskOverviewConfig) {
    statusFilter = config.statusFilter || "OPEN";
    priorityFilter = config.priorityFilter || "ALL";
    textFilter = config.textFilter || "";
    linkedPageFilter = config.linkedPageFilter || "";
    attributeFilterName = config.attributeFilterName || "";
    attributeFilterMode = config.attributeFilterMode === "missing" ? "missing" : "has";
    attributeFilterValue = config.attributeFilterValue || "";
    groupMode = isTaskOverviewGroupMode(config.groupMode) ? config.groupMode : "status";
    groupAttributeName = config.groupAttributeName || "";
  }

  function currentTaskOverviewConfig(): TaskOverviewConfig {
    return {
      statusFilter,
      priorityFilter,
      textFilter,
      linkedPageFilter,
      attributeFilterName,
      attributeFilterMode,
      attributeFilterValue,
      groupMode,
      groupAttributeName,
    };
  }

  function scheduleTaskOverviewConfigSave(config: TaskOverviewConfig, root: string) {
    const serialized = JSON.stringify(config);

    if (serialized === lastSavedConfigJson) {
      return;
    }

    if (saveConfigTimer) {
      clearTimeout(saveConfigTimer);
    }

    saveConfigTimer = setTimeout(() => {
      saveConfigTimer = null;
      if ($workspaceStore.root === root && loadedRoot === root) {
        persistTaskOverviewConfig(config, serialized, root);
      }
    }, 400);
  }

  function persistTaskOverviewConfig(
    config: TaskOverviewConfig,
    serialized = JSON.stringify(config),
    root = $workspaceStore.root,
  ) {
    lastSavedConfigJson = serialized;
    void workspaceStore.saveTaskOverviewConfig(config).then((saved) => {
      if (saved && $workspaceStore.root === root && loadedRoot === root) {
        lastSavedConfigJson = JSON.stringify(saved);
      }
    });
  }

  function flushTaskOverviewConfigSave() {
    if (saveConfigTimer) {
      clearTimeout(saveConfigTimer);
      saveConfigTimer = null;
    }

    if (!$workspaceStore.root || loadedRoot !== $workspaceStore.root) {
      return;
    }

    const config = currentTaskOverviewConfig();
    const serialized = JSON.stringify(config);
    if (serialized !== lastSavedConfigJson) {
      persistTaskOverviewConfig(config, serialized, $workspaceStore.root);
    }
  }

  function isTaskOverviewGroupMode(value: string): value is TaskOverviewGroupMode {
    return ["status", "priority", "source", "folder", "linked-page", "attribute"].includes(
      value,
    );
  }

  onDestroy(() => {
    flushTaskOverviewConfigSave();
  });
</script>

<svelte:window on:click={closeTaskContextMenu} />

<section class="task-overview" aria-label="Task overview">
  <header class="task-overview-header">
    <div>
      <h2>Tasks</h2>
      <small>{filteredTasks.length} of {$taskStore.tasks.length}</small>
    </div>
    <button type="button" on:click={refreshTasks} disabled={$taskStore.loading}>
      {$taskStore.loading ? "Refreshing" : "Refresh"}
    </button>
  </header>

  <div class="task-overview-toolbar">
    <select bind:value={statusFilter} aria-label="Filter tasks by status">
      <option value="OPEN">Open</option>
      {#each $workspaceStore.taskStates as state}
        <option value={state}>{state}</option>
      {/each}
      <option value="ALL">All</option>
    </select>
    <input
      type="search"
      bind:value={textFilter}
      placeholder="Search tasks"
      aria-label="Search tasks"
    />
    <select bind:value={priorityFilter} aria-label="Filter tasks by priority">
      <option value="ALL">All priorities</option>
      {#each availablePriorities as priority}
        <option value={priority}>#{priority}</option>
      {/each}
      <option value="NONE">No priority</option>
    </select>
    <select bind:value={groupMode} aria-label="Group tasks">
      <option value="status">Group by status</option>
      <option value="priority">Group by priority</option>
      <option value="source">Group by page</option>
      <option value="folder">Group by folder</option>
      <option value="linked-page">Group by linked page</option>
      <option value="attribute" disabled={availableAttributes.length === 0}>
        Group by attribute
      </option>
    </select>
    <div class="task-overview-toolbar-secondary">
      <select bind:value={linkedPageFilter} aria-label="Filter tasks by linked page">
        <option value="">All linked pages</option>
        {#each availableLinks as [identity, link]}
          <option value={identity}>{linkedPageLabel(link)}</option>
        {/each}
      </select>
      <select
        bind:value={attributeFilterName}
        aria-label="Filter tasks by attribute"
        disabled={availableAttributes.length === 0}
      >
        <option value="">All attributes</option>
        {#each availableAttributes as [name, label]}
          <option value={name}>{label}</option>
        {/each}
      </select>
      {#if attributeFilterName}
        <select bind:value={attributeFilterMode} aria-label="Choose attribute filter mode">
          <option value="has">Has / contains</option>
          <option value="missing">Is missing</option>
        </select>
        {#if attributeFilterMode === "has"}
          <input
            type="search"
            bind:value={attributeFilterValue}
            placeholder="Attribute value"
            aria-label="Filter tasks by attribute value"
          />
        {/if}
      {/if}
      {#if groupMode === "attribute"}
        <select bind:value={groupAttributeName} aria-label="Choose grouping attribute">
          {#each availableAttributes as [name, label]}
            <option value={name}>Group: {label}</option>
          {/each}
        </select>
      {/if}
    </div>
  </div>

  <ErrorDialog
    title="Task Error"
    message={localError ?? $taskStore.error}
    onClose={closeErrorDialog}
  />

  {#if !$taskStore.loading && filteredTasks.length === 0}
    <div class="empty-state">No tasks match the current filter.</div>
  {:else}
    <div class="task-overview-list">
      {#each groupedTasks as group}
        <section class="task-overview-group">
          <header>
            <strong>{group.label}</strong>
            <small>{group.items.length}</small>
          </header>
          {#each group.items as task}
            <article
              class:updating={updatingTaskKey === taskKey(task)}
              class="task-overview-row"
              on:contextmenu={(event) => openTaskContextMenu(task, event)}
            >
              {#if task.sourceHeadings.length > 0 || task.parentBlocks.length > 0}
                <small class="task-overview-context">
                  {#if task.sourceHeadings.length > 0}
                    <span>{taskHeadingContext(task)}</span>
                  {/if}
                  {#if task.parentBlocks.length > 0}
                    <span>{taskParentContext(task)}</span>
                  {/if}
                </small>
              {/if}
              <div class="task-overview-line">
                <div
                  class="task-overview-main"
                  role="button"
                  tabindex="0"
                  title="Open task page in the right pane"
                  on:click={(event) => handleTaskMainClick(task, event)}
                  on:keydown={(event) => handleTaskMainKeydown(task, event)}
                  on:contextmenu={(event) => openTaskContextMenu(task, event)}
                >
                  <span
                    class={`task-overview-status task-keyword task-${task.status.toLowerCase()}`}
                    style={taskColorStyle(task.status, $workspaceStore.taskStateColors)}
                    title="Change task"
                    role="button"
                    tabindex="0"
                    on:click|stopPropagation={(event) => openTaskContextMenu(task, event)}
                    on:keydown={(event) => handleTaskChipKeydown(task, event)}
                    on:contextmenu={(event) => openTaskContextMenu(task, event)}
                  >
                    {task.status}
                  </span>
                  {#if task.priority}
                    <span
                      class="task-overview-priority task-priority"
                      title={`Priority #${task.priority}`}
                      role="button"
                      tabindex="0"
                      on:click|stopPropagation={(event) => openTaskContextMenu(task, event)}
                      on:keydown={(event) => handleTaskChipKeydown(task, event)}
                      on:contextmenu={(event) => openTaskContextMenu(task, event)}
                    >
                      #{task.priority}
                    </span>
                  {/if}
                  {@html renderTaskText(task)}
                </div>
              </div>
              <button
                type="button"
                class="task-open-button"
                on:click={(event) => editTaskFromButton(task, event)}
              >
                Edit
              </button>
              {#if task.attributes.length > 0}
                <div class="task-overview-attributes" aria-label="Task attributes">
                  {#each task.attributes as attribute}
                    <!-- svelte-ignore a11y-click-events-have-key-events -->
                    <span
                      class:inherited={attribute.inherited}
                      class="task-overview-attribute"
                      title={attributeTitle(attribute)}
                      role="presentation"
                      on:click={followRenderedLink}
                    >
                      {#if attribute.inherited}
                        <span class="task-overview-attribute-inherited" aria-label="Inherited">↳</span>
                      {/if}
                      <span class="task-overview-attribute-key">{attribute.name}::</span>
                      <span class="task-overview-attribute-value">
                        {@html renderAttributeValue(task, attribute)}
                      </span>
                    </span>
                  {/each}
                </div>
              {/if}
            </article>
          {/each}
        </section>
      {/each}
    </div>
  {/if}
</section>

{#if taskContextMenu}
  {@const menu = taskContextMenu}
  <ContextMenuShell
    className="editor-link-menu"
    x={menu.x}
    y={menu.y}
    onClose={closeTaskContextMenu}
  >
    <details class="editor-submenu" open>
      <summary>Task</summary>
      <div class="editor-menu-flyout" role="menuitem" tabindex="0">
        <button type="button" class="editor-menu-flyout-trigger" data-menu-key="s">
          <span><span class="menu-mnemonic">S</span>tatus</span>
          <span aria-hidden="true">›</span>
        </button>
        <div class="editor-menu-flyout-panel" role="menu">
          {#each $workspaceStore.taskStates as state, index}
            <button
              type="button"
              role="menuitem"
              data-menu-key={String(index + 1)}
              disabled={state === menu.task.status}
              on:click={() => changeTaskStatus(menu.task, state)}
            >
              <span class="menu-mnemonic">{index + 1}</span> {state}
            </button>
          {/each}
        </div>
      </div>
      <div class="editor-menu-flyout" role="menuitem" tabindex="0">
        <button type="button" class="editor-menu-flyout-trigger" data-menu-key="p">
          <span><span class="menu-mnemonic">P</span>riority</span>
          <span aria-hidden="true">›</span>
        </button>
        <div class="editor-menu-flyout-panel" role="menu">
          <button
            type="button"
            role="menuitem"
            data-menu-key="0"
            disabled={menu.task.priority === null}
            on:click={() => changeTaskPriority(menu.task, null)}
          >
            <span class="menu-mnemonic">0</span> No priority
          </button>
          {#each editablePriorityOptions as priority}
            <button
              type="button"
              role="menuitem"
              data-menu-key={priority}
              disabled={menu.task.priority === priority}
              on:click={() => changeTaskPriority(menu.task, priority)}
            >
              #<span class="menu-mnemonic">{priority}</span>
            </button>
          {/each}
        </div>
      </div>
    </details>
  </ContextMenuShell>
{/if}
