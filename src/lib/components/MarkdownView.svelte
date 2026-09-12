<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import { writeText } from "@tauri-apps/plugin-clipboard-manager";
  import ContextMenuShell from "./ContextMenuShell.svelte";
  import ImageContextMenu from "./ImageContextMenu.svelte";
  import { createMarkdownRenderer } from "../markdownRenderer";
  import { renderCheckboxItems } from "../markdownRendering";
  import {
    renderedListMarker,
    SOURCE_LINE_RENDER_TOKEN_RULES,
    sourceLineForLocalLine,
    sourceLineFromContextMenuTarget,
    sourceLineSelectorForLine,
  } from "../markdownSourceLines";
  import {
    MERMAID_DIAGRAM_SELECTOR,
    MERMAID_ERROR_SELECTOR,
    MERMAID_OUTPUT_SELECTOR,
    MERMAID_SOURCE_SELECTOR,
    mermaidRenderErrorMessage,
    renderMermaidDiagram,
  } from "../mermaidRendering";
  import { themeStore } from "../stores/theme";
  import { taskColorStyle } from "../taskColors";
  import {
    DEFAULT_TASK_STATES,
    priorityCookieMatch,
    taskKeywordMatch,
  } from "../taskKeywords";
  import { applyWikiLinkColorStyles, renderWikiLinks } from "../wikiLinks";
  import type { LinkTargetPane } from "../stores/linkOperations";
  import type { FolderColors, PageSummary, TaskStateColors, ThemeMode } from "../types";
  import type { ImageContextMenuTarget } from "../imageClipboard";
  import { runUserAction } from "../stores/appErrors";

  export let content = "";
  export let sourcePath = "";
  export let pages: PageSummary[] = [];
  export let taskStates: string[] = DEFAULT_TASK_STATES;
  export let taskStateColors: TaskStateColors = {};
  export let folderColors: FolderColors = {};
  export let sourceLineNumbers: number[] = [];
  export let highlightedLine: number | null = null;
  export let highlightToken = 0;
  export let onWikiLink: (target: string) => void = () => {};
  export let onMissingWikiLink: (target: string) => void = () => {};
  export let onCheckboxToggle: (line: number, checked: boolean) => void = () => {};
  export let onOpenWikiLink: (target: string, targetPane: LinkTargetPane) => void = () => {};
  export let onOpenSourceLineInEditor: (line: number) => void = () => {};
  export let onOpenSourceLineInRightPane: (line: number) => void = () => {};
  export let sourceLineMenuTargets: Array<"editor" | "right"> = [];
  export let onTaskStatusChange: (
    line: number,
    currentStatus: string,
    nextStatus: string,
  ) => void = () => {};
  export let onTaskPriorityChange: (
    line: number,
    currentPriority: string | null,
    nextPriority: string | null,
  ) => void = () => {};
  export let enableTaskContextMenu = false;
  export let enableTextCopyContextMenu = false;
  export let enableMermaid = false;

  let linkContextMenu: {
    x: number;
    y: number;
    label: string;
    target: string;
    exists: boolean;
    line: number | null;
  } | null = null;
  let taskContextMenu: {
    x: number;
    y: number;
    line: number;
    localLine: number;
    status: string;
  } | null = null;
  let sourceLineContextMenu: {
    x: number;
    y: number;
    line: number | null;
  } | null = null;
  let imageContextMenu: ImageContextMenuTarget | null = null;
  let contextSelectionText = "";
  let markdownElement: HTMLElement | null = null;
  let lastHighlightKey = "";
  let lastObservedWidth: number | null = null;
  let highlightTimer: ReturnType<typeof setTimeout> | null = null;
  let mermaidObserver: IntersectionObserver | null = null;
  let mermaidRenderGeneration = 0;
  const taskPriorityOptions = ["A", "B", "C"];

  const markdown = createMarkdownRenderer({
    breaks: true,
    workspaceImages: true,
    mermaidCodeBlocks: enableMermaid,
  });
  const markdownWithSourceLines = markdown as unknown as MarkdownItWithSourceLines;

  $: taskRender = markTaskKeywordsForRendering(content, taskStates, sourceLineNumbers);
  $: rendered = renderTaskPriorityMarkers(
    renderTaskKeywordMarkers(
      renderCheckboxItems(
        applyWikiLinkColorStyles(
          renderMarkdownWithSourceLines(renderWikiLinks(taskRender.markdown, pages)),
          pages,
          folderColors,
        ),
        content,
        sourceLineNumbers,
      ),
      taskRender.taskTokens,
    ),
    taskRender.priorityTokens,
  );
  $: mermaidRenderRequest = enableMermaid
    ? { renderedHtml: rendered, theme: $themeStore }
    : null;
  $: if (markdownElement && mermaidRenderRequest) {
    void scheduleMermaidRendering(mermaidRenderRequest.theme);
  }
  $: highlightKey = highlightedLine ? `${highlightToken}:${highlightedLine}` : "";
  $: if (markdownElement && highlightKey !== lastHighlightKey) {
    lastHighlightKey = highlightKey;
    if (highlightedLine) {
      void scrollHighlightedLineIntoView();
    } else {
      clearHighlightedLineHighlight();
    }
  }

  onMount(() => {
    if (!markdownElement || typeof ResizeObserver === "undefined") {
      return;
    }

    const resizeObserver = new ResizeObserver(([entry]) => {
      if (!entry) {
        return;
      }

      const nextWidth = entry.contentRect.width;
      if (lastObservedWidth === null) {
        lastObservedWidth = nextWidth;
        return;
      }

      if (Math.abs(nextWidth - lastObservedWidth) > 0.5) {
        lastObservedWidth = nextWidth;
        clearHighlightedLineHighlight();
      }
    });

    resizeObserver.observe(markdownElement);

    return () => resizeObserver.disconnect();
  });

  onDestroy(() => {
    mermaidRenderGeneration += 1;
    mermaidObserver?.disconnect();
    clearHighlightedLineHighlight();
  });

  async function scheduleMermaidRendering(theme: ThemeMode) {
    const generation = ++mermaidRenderGeneration;
    mermaidObserver?.disconnect();
    mermaidObserver = null;

    await tick();
    if (generation !== mermaidRenderGeneration || !markdownElement) {
      return;
    }

    const diagrams = Array.from(
      markdownElement.querySelectorAll<HTMLElement>(MERMAID_DIAGRAM_SELECTOR),
    ).filter((diagram) => diagram.dataset.mermaidRenderedTheme !== theme);
    if (diagrams.length === 0) {
      return;
    }

    if (typeof IntersectionObserver === "undefined") {
      for (const diagram of diagrams) {
        void renderVisibleMermaidDiagram(diagram, theme, generation);
      }
      return;
    }

    mermaidObserver = new IntersectionObserver(
      (entries, observer) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) {
            continue;
          }

          observer.unobserve(entry.target);
          void renderVisibleMermaidDiagram(entry.target as HTMLElement, theme, generation);
        }
      },
      { rootMargin: "240px 0px" },
    );
    for (const diagram of diagrams) {
      mermaidObserver.observe(diagram);
    }
  }

  async function renderVisibleMermaidDiagram(
    diagram: HTMLElement,
    theme: ThemeMode,
    generation: number,
  ) {
    const sourceElement = diagram.querySelector<HTMLElement>(MERMAID_SOURCE_SELECTOR);
    const sourceContainer = sourceElement?.closest<HTMLElement>(".mermaid-diagram-source");
    const output = diagram.querySelector<HTMLElement>(MERMAID_OUTPUT_SELECTOR);
    const error = diagram.querySelector<HTMLElement>(MERMAID_ERROR_SELECTOR);
    if (!sourceElement || !sourceContainer || !output || !error) {
      return;
    }

    const renderKey = `${generation}:${theme}`;
    if (diagram.dataset.mermaidRenderKey === renderKey) {
      return;
    }

    diagram.dataset.mermaidRenderKey = renderKey;
    diagram.setAttribute("aria-busy", "true");
    try {
      const svg = await renderMermaidDiagram(sourceElement.textContent ?? "", theme);
      if (generation !== mermaidRenderGeneration || !diagram.isConnected) {
        return;
      }

      output.innerHTML = svg;
      output.hidden = false;
      sourceContainer.hidden = true;
      error.hidden = true;
      error.textContent = "";
      diagram.dataset.mermaidRenderedTheme = theme;
      diagram.removeAttribute("aria-busy");
    } catch (renderError) {
      if (generation !== mermaidRenderGeneration || !diagram.isConnected) {
        return;
      }

      output.replaceChildren();
      output.hidden = true;
      sourceContainer.hidden = false;
      error.textContent = mermaidRenderErrorMessage(renderError);
      error.hidden = false;
      diagram.removeAttribute("aria-busy");
    }
  }

  for (const rule of SOURCE_LINE_RENDER_TOKEN_RULES) {
    markdownWithSourceLines.renderer.rules[rule] = renderTokenWithSourceLine;
  }

  function renderTokenWithSourceLine(
    tokens: MarkdownToken[],
    index: number,
    options: unknown,
    env: MarkdownRenderEnv,
    self: MarkdownRenderer,
  ) {
    const token = tokens[index];
    const localLine = token?.map?.[0];
    if (localLine !== undefined) {
      const line = sourceLineForLocalLine(localLine + 1, env.sourceLineNumbers);
      token.attrSet("data-source-line", String(line));
    }

    const listMarker = renderedListMarker(token);
    if (listMarker !== null) {
      token.attrSet("data-list-marker", listMarker);
    }

    return self.renderToken(tokens, index, options);
  }

  function renderMarkdownWithSourceLines(markdownContent: string) {
    return markdownWithSourceLines.render(markdownContent, { sourceLineNumbers, sourcePath });
  }

  function renderTaskKeywordMarkers(html: string, tokens: TaskKeywordToken[]) {
    let renderedHtml = html;

    for (const token of tokens) {
      renderedHtml = renderedHtml.replaceAll(
        token.marker,
        `<strong class="task-keyword task-${safeTaskClass(token.status)}" style="${taskColorStyle(token.status, taskStateColors)}" data-task-line="${token.line}" data-task-local-line="${token.localLine}" data-task-status="${token.status}">${token.status}</strong>`,
      );
    }

    return renderedHtml;
  }

  function renderTaskPriorityMarkers(html: string, tokens: TaskPriorityToken[]) {
    let renderedHtml = html;

    for (const token of tokens) {
      renderedHtml = renderedHtml.replaceAll(
        token.marker,
        `<span class="task-priority" data-task-line="${token.line}" data-task-local-line="${token.localLine}" data-task-status="${token.status}">#${token.priority}</span>`,
      );
    }

    return renderedHtml;
  }

  function renderTaskMarkers(
    line: string,
    index: number,
    states: string[],
    lineNumbers: number[],
    taskTokens: TaskKeywordToken[],
    priorityTokens: TaskPriorityToken[],
  ) {
    const taskMatch = taskKeywordMatch(line, 0, states);
    if (!taskMatch) {
      return line;
    }

    const replacements = [];
    const localLine = index + 1;
    const sourceLine = lineNumbers[index] ?? localLine;
    const taskMarker = `LOGTEXT_TASK_${taskTokens.length}_TOKEN`;
    taskTokens.push({
      line: sourceLine,
      localLine,
      status: taskMatch.status,
      marker: taskMarker,
    });
    replacements.push({ from: taskMatch.from, to: taskMatch.to, marker: taskMarker });

    const priorityMatch = priorityCookieMatch(line, 0, states);
    if (priorityMatch) {
      const priorityMarker = `LOGTEXT_PRIORITY_${priorityTokens.length}_TOKEN`;
      priorityTokens.push({
        line: sourceLine,
        localLine,
        status: taskMatch.status,
        priority: priorityMatch.priority,
        marker: priorityMarker,
      });
      replacements.push({
        from: priorityMatch.from,
        to: priorityMatch.to,
        marker: priorityMarker,
      });
    }

    return replacements
      .sort((left, right) => right.from - left.from)
      .reduce(
        (markedLine, replacement) =>
          `${markedLine.slice(0, replacement.from)}${replacement.marker}${markedLine.slice(
            replacement.to,
          )}`,
        line,
      );
  }

  function handleClick(event: MouseEvent) {
    linkContextMenu = null;
    taskContextMenu = null;
    sourceLineContextMenu = null;
    imageContextMenu = null;

    const checkbox = (event.target as HTMLElement).closest<HTMLInputElement>(
      "input.task-list-checkbox",
    );
    if (checkbox) {
      event.preventDefault();
      const line = Number(checkbox.dataset.line);
      if (Number.isInteger(line) && line > 0) {
        onCheckboxToggle(line, !checkbox.checked);
      }
      return;
    }

    const link = (event.target as HTMLElement).closest("a");
    const href = link?.getAttribute("href");

    if (href?.startsWith("logtext-missing:")) {
      event.preventDefault();
      onMissingWikiLink(decodeURIComponent(href.slice("logtext-missing:".length)));
      return;
    }

    if (!href?.startsWith("logtext:")) {
      return;
    }

    event.preventDefault();
    onWikiLink(decodeURIComponent(href.slice("logtext:".length)));
  }

  function handleContextMenu(event: MouseEvent) {
    const image = (event.target as HTMLElement).closest<HTMLImageElement>(
      'img.workspace-image[data-workspace-image="true"]',
    );
    if (image) {
      event.preventDefault();
      event.stopPropagation();
      linkContextMenu = null;
      taskContextMenu = null;
      sourceLineContextMenu = null;
      contextSelectionText = "";
      imageContextMenu = { x: event.clientX, y: event.clientY, image };
      return;
    }
    imageContextMenu = null;
    contextSelectionText = selectedRenderedTextAtPoint(event);

    if (enableTaskContextMenu) {
      const taskKeyword = (event.target as HTMLElement).closest<HTMLElement>(
        ".task-keyword, .task-priority",
      );
      const line = Number(taskKeyword?.dataset.taskLine);
      const status = taskKeyword?.dataset.taskStatus;

      if (taskKeyword && Number.isInteger(line) && line > 0 && status) {
        event.preventDefault();
        event.stopPropagation();
        linkContextMenu = null;
        sourceLineContextMenu = null;
        taskContextMenu = {
          x: event.clientX,
          y: event.clientY,
          line,
          localLine: Number(taskKeyword.dataset.taskLocalLine) || line,
          status,
        };
        return;
      }
    }

    const link = (event.target as HTMLElement).closest("a");
    const href = link?.getAttribute("href");

    if (!href?.startsWith("logtext:") && !href?.startsWith("logtext-missing:")) {
      if (sourceLineMenuTargets.length === 0 && !contextSelectionText) {
        return;
      }

      const line = sourceLineFromContextMenuTarget(event.target);

      if (line === null && !contextSelectionText) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      linkContextMenu = null;
      taskContextMenu = null;
      sourceLineContextMenu = {
        x: event.clientX,
        y: event.clientY,
        line,
      };
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    taskContextMenu = null;
    sourceLineContextMenu = null;
    const missing = href.startsWith("logtext-missing:");
    const prefix = missing ? "logtext-missing:" : "logtext:";
    linkContextMenu = {
      x: event.clientX,
      y: event.clientY,
      label: link?.textContent?.trim() || decodeURIComponent(href.slice(prefix.length)),
      target: decodeURIComponent(href.slice(prefix.length)),
      exists: !missing,
      line: sourceLineFromContextMenuTarget(event.target),
    };
  }

  function openSourceLine(targetPane: "editor" | "right") {
    if (!sourceLineContextMenu || sourceLineContextMenu.line === null) {
      return;
    }

    const { line } = sourceLineContextMenu;
    sourceLineContextMenu = null;

    if (targetPane === "editor") {
      onOpenSourceLineInEditor(line);
    } else {
      onOpenSourceLineInRightPane(line);
    }
  }

  function openContextLinkInEditor() {
    if (!linkContextMenu?.exists) {
      return;
    }

    const target = linkContextMenu.target;
    linkContextMenu = null;

    onOpenWikiLink(target, "editor");
  }

  function showContextLinkSourceLineInEditor() {
    if (!linkContextMenu || linkContextMenu.line === null) {
      return;
    }

    const { line } = linkContextMenu;
    linkContextMenu = null;
    onOpenSourceLineInEditor(line);
  }

  function createContextLinkPage() {
    if (!linkContextMenu || linkContextMenu.exists) {
      return;
    }

    const target = linkContextMenu.target;
    linkContextMenu = null;
    onMissingWikiLink(target);
  }

  function closeContextMenu() {
    linkContextMenu = null;
    taskContextMenu = null;
    sourceLineContextMenu = null;
    imageContextMenu = null;
    contextSelectionText = "";
  }

  function selectedRenderedTextAtPoint(event: MouseEvent) {
    if (!enableTextCopyContextMenu || !markdownElement) {
      return "";
    }

    const selection = window.getSelection();
    if (
      !selection ||
      selection.isCollapsed ||
      selection.rangeCount === 0 ||
      !markdownElement.contains(selection.anchorNode) ||
      !markdownElement.contains(selection.focusNode)
    ) {
      return "";
    }

    const range = selection.getRangeAt(0);
    const clickedSelection = Array.from(range.getClientRects()).some(
      (rect) =>
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom,
    );
    return clickedSelection ? selection.toString() : "";
  }

  function copyRenderedSelection() {
    const text = contextSelectionText;
    if (!text) {
      return;
    }

    closeContextMenu();
    void runUserAction("Copy text", () => writeText(text));
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      closeContextMenu();
    }
  }

  function setTaskStatus(nextStatus: string) {
    if (!taskContextMenu) {
      return;
    }

    const { line, status } = taskContextMenu;
    taskContextMenu = null;
    onTaskStatusChange(line, status, nextStatus);
  }

  function setTaskPriority(priority: string | null) {
    if (!taskContextMenu) {
      return;
    }

    const { line } = taskContextMenu;
    const previousPriority = currentTaskPriority();
    taskContextMenu = null;
    onTaskPriorityChange(line, previousPriority, priority);
  }

  function showTaskSourceLineInEditor() {
    if (!taskContextMenu) {
      return;
    }

    const { line } = taskContextMenu;
    taskContextMenu = null;
    onOpenSourceLineInEditor(line);
  }

  function currentTaskPriority() {
    if (!taskContextMenu) {
      return null;
    }

    const lineText = content.split("\n")[taskContextMenu.localLine - 1] ?? "";
    return priorityCookieMatch(lineText, 0, taskStates)?.priority ?? null;
  }

  function safeTaskClass(status: string) {
    return status.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  }

  async function scrollHighlightedLineIntoView() {
    await tick();
    if (!markdownElement || !highlightedLine) {
      return;
    }

    clearHighlightedLineHighlight();

    const marker = markdownElement.querySelector<HTMLElement>(
      sourceLineSelectorForLine(highlightedLine),
    );
    if (!marker) {
      return;
    }

    marker.scrollIntoView({ block: "center", behavior: "smooth" });
    marker.classList.add("markdown-line-highlight");

    if (highlightTimer) {
      clearTimeout(highlightTimer);
    }

    highlightTimer = setTimeout(() => {
      clearHighlightedLineHighlight();
      highlightTimer = null;
    }, 1800);
  }

  function clearHighlightedLineHighlight() {
    if (highlightTimer) {
      clearTimeout(highlightTimer);
      highlightTimer = null;
    }

    markdownElement
      ?.querySelectorAll(".markdown-line-highlight")
      .forEach((element) => element.classList.remove("markdown-line-highlight"));
  }

  function markTaskKeywordsForRendering(
    markdownContent: string,
    states: string[],
    lineNumbers: number[],
  ) {
    const taskTokens: TaskKeywordToken[] = [];
    const priorityTokens: TaskPriorityToken[] = [];
    const markedMarkdown = markdownContent
      .split("\n")
      .map((line, index) =>
        renderTaskMarkers(line, index, states, lineNumbers, taskTokens, priorityTokens),
      )
      .join("\n");

    return {
      markdown: markedMarkdown,
      taskTokens,
      priorityTokens,
    };
  }

  type TaskKeywordToken = {
    line: number;
    localLine: number;
    status: string;
    marker: string;
  };

  type TaskPriorityToken = TaskKeywordToken & {
    priority: string;
  };

  type MarkdownToken = {
    type: string;
    info: string;
    markup: string;
    map: [number, number] | null;
    attrSet(name: string, value: string): void;
  };

  type MarkdownRenderEnv = {
    sourceLineNumbers: number[];
    sourcePath: string;
  };

  type MarkdownRenderer = {
    renderToken(tokens: MarkdownToken[], index: number, options: unknown): string;
  };

  type MarkdownItWithSourceLines = {
    renderer: {
      rules: Record<string, typeof renderTokenWithSourceLine>;
    };
    render(markdownContent: string, env: MarkdownRenderEnv): string;
  };
</script>

<svelte:window on:click={closeContextMenu} on:keydown={handleWindowKeydown} />

<div
  bind:this={markdownElement}
  class="markdown-view"
  role="presentation"
  on:click={handleClick}
  on:contextmenu={handleContextMenu}
  on:keydown={() => {}}
>
  {@html rendered}
</div>

{#if imageContextMenu}
  <ImageContextMenu
    x={imageContextMenu.x}
    y={imageContextMenu.y}
    image={imageContextMenu.image}
    onClose={closeContextMenu}
  />
{/if}

{#if linkContextMenu}
  <ContextMenuShell
    className="editor-link-menu"
    x={linkContextMenu.x}
    y={linkContextMenu.y}
    onClose={closeContextMenu}
  >
    <div class="editor-link-menu-title" title={linkContextMenu.target}>
      {linkContextMenu.label}
    </div>
    <button
      type="button"
      role="menuitem"
      data-menu-key="e"
      disabled={!linkContextMenu.exists}
      on:click={openContextLinkInEditor}
    >
      Follow link in <span class="menu-mnemonic">e</span>ditor
    </button>
    {#if linkContextMenu.line !== null && sourceLineMenuTargets.includes("editor")}
      <button
        type="button"
        role="menuitem"
        data-menu-key="s"
        on:click={showContextLinkSourceLineInEditor}
      >
        <span class="menu-mnemonic">S</span>how line in editor
      </button>
    {/if}
    {#if !linkContextMenu.exists}
      <button type="button" role="menuitem" data-menu-key="n" on:click={createContextLinkPage}>
        Create <span class="menu-mnemonic">n</span>ew page
      </button>
    {/if}
    {#if contextSelectionText}
      <div class="context-menu-separator"></div>
      <button
        type="button"
        class="context-menu-action"
        role="menuitem"
        data-menu-key="c"
        on:click={copyRenderedSelection}
      >
        <span><span class="menu-mnemonic">C</span>opy</span>
        <span class="context-menu-shortcut" aria-hidden="true">Ctrl+C</span>
      </button>
    {/if}
  </ContextMenuShell>
{/if}

{#if sourceLineContextMenu}
  <ContextMenuShell
    className="editor-link-menu"
    x={sourceLineContextMenu.x}
    y={sourceLineContextMenu.y}
    onClose={closeContextMenu}
  >
    {#if sourceLineContextMenu.line !== null && sourceLineMenuTargets.includes("editor")}
      <button
        type="button"
        role="menuitem"
        data-menu-key="e"
        on:click={() => openSourceLine("editor")}
      >
        Open line in <span class="menu-mnemonic">e</span>ditor
      </button>
    {/if}
    {#if sourceLineContextMenu.line !== null && sourceLineMenuTargets.includes("right")}
      <button
        type="button"
        role="menuitem"
        data-menu-key="r"
        on:click={() => openSourceLine("right")}
      >
        Open line in <span class="menu-mnemonic">r</span>ight pane
      </button>
    {/if}
    {#if contextSelectionText}
      {#if sourceLineContextMenu.line !== null}
        <div class="context-menu-separator"></div>
      {/if}
      <button
        type="button"
        class="context-menu-action"
        role="menuitem"
        data-menu-key="c"
        on:click={copyRenderedSelection}
      >
        <span><span class="menu-mnemonic">C</span>opy</span>
        <span class="context-menu-shortcut" aria-hidden="true">Ctrl+C</span>
      </button>
    {/if}
  </ContextMenuShell>
{/if}

{#if taskContextMenu}
  {@const currentPriority = currentTaskPriority()}
  <ContextMenuShell
    className="editor-link-menu"
    x={taskContextMenu.x}
    y={taskContextMenu.y}
    onClose={closeContextMenu}
  >
    <div class="editor-menu-flyout" role="menuitem" tabindex="0">
      <button type="button" class="editor-menu-flyout-trigger" data-menu-key="s">
        <span><span class="menu-mnemonic">S</span>tatus</span>
        <span aria-hidden="true">›</span>
      </button>
      <div class="editor-menu-flyout-panel" role="menu">
        {#each taskStates as state, index}
          <button
            type="button"
            role="menuitem"
            data-menu-key={String(index + 1)}
            disabled={state === taskContextMenu.status}
            on:click={() => setTaskStatus(state)}
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
          disabled={currentPriority === null}
          on:click={() => setTaskPriority(null)}
        >
          <span class="menu-mnemonic">0</span> No priority
        </button>
        {#each taskPriorityOptions as priority}
          <button
            type="button"
            role="menuitem"
            data-menu-key={priority}
            disabled={currentPriority === priority}
            on:click={() => setTaskPriority(priority)}
          >
            #<span class="menu-mnemonic">{priority}</span>
          </button>
        {/each}
      </div>
    </div>
    <button
      type="button"
      role="menuitem"
      data-menu-key="e"
      on:click={showTaskSourceLineInEditor}
    >
      Show line in <span class="menu-mnemonic">e</span>ditor
    </button>
  </ContextMenuShell>
{/if}
