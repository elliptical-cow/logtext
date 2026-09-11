<script lang="ts">
  import {
    autocompletion,
    type CompletionContext,
    type CompletionResult,
  } from "@codemirror/autocomplete";
  import { markdown } from "@codemirror/lang-markdown";
  import { Compartment, EditorState, StateEffect, StateField, Transaction } from "@codemirror/state";
  import {
    Decoration,
    EditorView,
    keymap,
    lineNumbers,
    type Command,
    type DecorationSet,
  } from "@codemirror/view";
  import {
    readImage,
    readText,
    writeText,
  } from "@tauri-apps/plugin-clipboard-manager";
  import {
    defaultKeymap,
    history,
    isolateHistory,
    redo,
    redoDepth,
    undo,
    undoDepth,
  } from "@codemirror/commands";
  import { onDestroy, onMount, tick } from "svelte";
  import ContextMenuShell from "./ContextMenuShell.svelte";
  import ImageContextMenu from "./ImageContextMenu.svelte";
  import {
    applyInlineMarkdownFormat,
    canApplyInlineMarkdownFormat,
    type InlineMarkdownFormat,
  } from "../editorTextFormatting";
  import {
    blockFoldingExtension,
    collapseAllBlocksBelowLevel,
    collapseBlock,
    collapsibleBlockAtLine,
    ensureLineVisible,
    expandAllBlockFolds,
    expandBlock,
    foldedBlockAtLine,
  } from "../editorBlockFolding";
  import {
    blockEditingKeymap,
    blockRangeForCursorLine,
    indentSelectedBlocks,
    movableBlockRanges,
    moveCurrentBlock,
    outdentSelectedBlocks,
  } from "../editorBlockCommands";
  import { listWrapIndentExtension } from "../editorLineWrapping";
  import {
    checkboxAtDocumentPosition,
    activeBlockLineNumbers,
    livePreviewExtension,
    taskKeywordAtDocumentPosition,
    wikiLinkAtDocumentPosition,
    type EditorMode,
    type TaskKeywordAtPosition,
    type WikiLinkAtPosition,
  } from "../editorLivePreview";
  import { DEFAULT_TASK_STATES, priorityCookieMatch, taskPriorityChange } from "../taskKeywords";
  import { playTaskDoneSound } from "../taskCompletionSound";
  import {
    editorContextMenuKind,
    editorContextMenuSelection,
    type EditorContextMenuKind,
  } from "../editorContextMenu";
  import { minimalTextChange } from "../textChanges";
  import { isSupportedClipboardImageType, pastedImageMarkdown } from "../pastedImages";
  import {
    matchWikiLinkCompletion,
    wikiLinkCompletionApply,
    wikiLinkSuggestions,
  } from "../wikiLinkCompletion";
  import { resolveWikiTarget } from "../wikiLinks";
  import type { LinkTargetPane } from "../stores/linkOperations";
  import type { FolderColors, PageSummary, TaskStateColors } from "../types";
  import {
    clipboardImageToPngFile,
    type ImageContextMenuTarget,
  } from "../imageClipboard";
  import { runUserAction } from "../stores/appErrors";

  export let value = "";
  export let documentPath: string | null = null;
  export let pages: PageSummary[] = [];
  export let taskStates: string[] = DEFAULT_TASK_STATES;
  export let taskStateColors: TaskStateColors = {};
  export let folderColors: FolderColors = {};
  export let taskDoneSoundEnabled = true;
  export let disabled = false;
  export let revealLine: number | null = null;
  export let revealToken = 0;
  export let mode: EditorMode = "source";
  export let onChange: (value: string) => void = () => {};
  export let onSave: (content: string) => void = () => {};
  export let onEditorHistoryChange: (path: string | null) => void = () => {};
  export let onEditorHistoryDiscard: (path: string | null) => void = () => {};
  export let onOpenWikiLink: (path: string, targetPane: LinkTargetPane) => void = () => {};
  export let onMissingWikiLink: (path: string) => void = () => {};
  export let onOpenSourceLineInRightPane: (line: number) => void = () => {};
  export let onPasteImage: (
    documentPath: string,
    mimeType: string,
    bytes: Uint8Array,
  ) => Promise<string> = async () => {
    throw new Error("Image paste is unavailable");
  };
  export let onPasteImageError: (error: unknown) => void = () => {};
  type ContextMenuLink = {
    link: WikiLinkAtPosition;
    resolvedPath: string | null;
    resolvedExists: boolean;
  };

  type EditorContextMenu = {
    kind: EditorContextMenuKind;
    x: number;
    y: number;
    line: number;
    selection: { from: number; to: number } | null;
    task: TaskKeywordAtPosition | null;
    link: ContextMenuLink | null;
  };

  let host: HTMLDivElement;
  let view: EditorView | null = null;
  let editorContextMenu: EditorContextMenu | null = null;
  let imageContextMenu: ImageContextMenuTarget | null = null;
  let applyingExternalValue = false;
  let applyingHistoryCommand = false;
  let lastDocumentPath: string | null = null;
  let lastRevealToken = 0;
  let suppressCheckboxClick = false;
  let suppressWikiLinkClick = false;
  let highlightTimer: ReturnType<typeof setTimeout> | null = null;
  let searchOpen = false;
  let replaceOpen = false;
  let searchQuery = "";
  let replaceText = "";
  let searchMatches: Array<{ from: number; to: number }> = [];
  let searchActiveIndex = 0;
  let searchInput: HTMLInputElement;
  let replaceInput: HTMLInputElement;
  let lastHistoryAvailability = "";
  let nextImagePasteId = 1;
  const editable = new Compartment();
  const completions = new Compartment();
  const previewMode = new Compartment();
  const blockKeys = new Compartment();
  const taskPriorityOptions = ["A", "B", "C"];
  const highlightLineEffect = StateEffect.define<number | null>();
  type PendingImagePaste = { id: number; from: number; to: number };
  const beginImagePasteEffect = StateEffect.define<PendingImagePaste>();
  const finishImagePasteEffect = StateEffect.define<number>();
  const pendingImagePastesField = StateField.define<PendingImagePaste[]>({
    create: () => [],
    update(pendingPastes, transaction) {
      let next = pendingPastes.map((pending) => {
        if (pending.from === pending.to) {
          const position = transaction.changes.mapPos(pending.from, 1);
          return { ...pending, from: position, to: position };
        }
        return {
          ...pending,
          from: transaction.changes.mapPos(pending.from, -1),
          to: transaction.changes.mapPos(pending.to, 1),
        };
      });

      for (const effect of transaction.effects) {
        if (effect.is(beginImagePasteEffect)) {
          next = [...next, effect.value];
        } else if (effect.is(finishImagePasteEffect)) {
          next = next.filter((pending) => pending.id !== effect.value);
        }
      }

      return next;
    },
  });
  const highlightLineField = StateField.define<DecorationSet>({
    create() {
      return Decoration.none;
    },
    update(highlights, transaction) {
      let next = highlights.map(transaction.changes);

      for (const effect of transaction.effects) {
        if (effect.is(highlightLineEffect)) {
          next =
            effect.value === null
              ? Decoration.none
              : Decoration.set([Decoration.line({ class: "cm-line-highlight" }).range(effect.value)]);
        }
      }

      return next;
    },
    provide: (field) => EditorView.decorations.from(field),
  });
  const searchDecorationsEffect = StateEffect.define<{
    matches: Array<{ from: number; to: number }>;
    activeIndex: number;
  }>();
  const searchDecorationsField = StateField.define<DecorationSet>({
    create() {
      return Decoration.none;
    },
    update(decorations, transaction) {
      let next = decorations.map(transaction.changes);

      for (const effect of transaction.effects) {
        if (effect.is(searchDecorationsEffect)) {
          next = Decoration.set(
            effect.value.matches.map((match, index) =>
              Decoration.mark({
                class:
                  index === effect.value.activeIndex
                    ? "cm-search-match cm-search-match-active"
                    : "cm-search-match",
              }).range(match.from, match.to),
            ),
            true,
          );
        }
      }

      return next;
    },
    provide: (field) => EditorView.decorations.from(field),
  });

  const saveKeymap = keymap.of([
    {
      key: "Mod-s",
      run() {
        saveCurrentDocument();
        return true;
      },
    },
    {
      key: "Mod-f",
      run(editorView) {
        openDocumentSearch(editorView);
        return true;
      },
      preventDefault: true,
    },
  ]);

  export function saveCurrentDocument() {
    const content = view?.state.doc.toString() ?? value;
    onChange(content);
    onSave(content);
  }

  function undoCurrentDocument() {
    if (view) {
      applyingHistoryCommand = true;
      const changed = undo(view);
      queueMicrotask(() => {
        applyingHistoryCommand = false;
      });
      return changed;
    }
    return false;
  }

  function redoCurrentDocument() {
    if (view) {
      applyingHistoryCommand = true;
      const changed = redo(view);
      queueMicrotask(() => {
        applyingHistoryCommand = false;
      });
      return changed;
    }
    return false;
  }

  function emitEditorHistoryAvailability() {
    const availability = view
      ? { undo: undoDepth(view.state) > 0, redo: redoDepth(view.state) > 0 }
      : { undo: false, redo: false };
    const serialized = JSON.stringify(availability);
    if (serialized === lastHistoryAvailability) {
      return;
    }

    lastHistoryAvailability = serialized;
    window.dispatchEvent(
      new CustomEvent("logtext-editor-history-availability", {
        detail: availability,
      }),
    );
  }

  function isolateEditorHistory() {
    view?.dispatch({
      annotations: [
        Transaction.addToHistory.of(false),
        isolateHistory.of("full"),
      ],
    });
  }

  async function openDocumentSearch(editorView = view) {
    if (!editorView) {
      return;
    }

    const selection = editorView.state.selection.main;
    if (selection.from !== selection.to) {
      searchQuery = editorView.state.sliceDoc(selection.from, selection.to);
      searchActiveIndex = 0;
    }

    searchOpen = true;
    refreshDocumentSearch();
    await tick();
    searchInput?.focus();
    searchInput?.select();
  }

  function closeDocumentSearch() {
    searchOpen = false;
    replaceOpen = false;
    searchQuery = "";
    replaceText = "";
    searchMatches = [];
    searchActiveIndex = 0;
    view?.dispatch({ effects: searchDecorationsEffect.of({ matches: [], activeIndex: 0 }) });
    view?.focus();
  }

  function documentSearchMatches(query: string) {
    if (!view || query.length === 0) {
      return [];
    }

    const documentText = view.state.doc.toString();
    const haystack = documentText.toLocaleLowerCase();
    const needle = query.toLocaleLowerCase();
    const matches: Array<{ from: number; to: number }> = [];
    let from = 0;

    while (matches.length < 1000) {
      const index = haystack.indexOf(needle, from);
      if (index === -1) {
        break;
      }

      matches.push({ from: index, to: index + query.length });
      from = index + Math.max(query.length, 1);
    }

    return matches;
  }

  function refreshDocumentSearch() {
    if (!view) {
      return;
    }

    searchMatches = documentSearchMatches(searchQuery);
    searchActiveIndex =
      searchMatches.length === 0
        ? 0
        : Math.min(Math.max(searchActiveIndex, 0), searchMatches.length - 1);
    view.dispatch({
      effects: searchDecorationsEffect.of({
        matches: searchMatches,
        activeIndex: searchActiveIndex,
      }),
    });
    scrollActiveSearchMatchIntoView();
  }

  function scrollActiveSearchMatchIntoView() {
    if (!view || searchMatches.length === 0) {
      return;
    }

    const match = searchMatches[searchActiveIndex];
    view.dispatch({
      selection: { anchor: match.from, head: match.to },
      effects: EditorView.scrollIntoView(match.from, { y: "center" }),
    });
  }

  function moveDocumentSearch(direction: 1 | -1) {
    if (searchMatches.length === 0) {
      return;
    }

    searchActiveIndex =
      (searchActiveIndex + direction + searchMatches.length) % searchMatches.length;
    view?.dispatch({
      effects: searchDecorationsEffect.of({
        matches: searchMatches,
        activeIndex: searchActiveIndex,
      }),
    });
    scrollActiveSearchMatchIntoView();
  }

  function replaceCurrentSearchMatch() {
    if (!view || searchMatches.length === 0) {
      return;
    }

    const match = searchMatches[searchActiveIndex];
    view.dispatch({
      changes: { from: match.from, to: match.to, insert: replaceText },
      selection: { anchor: match.from + replaceText.length },
    });
    refreshDocumentSearch();
    view.focus();
  }

  function replaceAllDocumentSearch() {
    if (!view || searchMatches.length === 0) {
      return;
    }

    const changes = searchMatches
      .slice()
      .reverse()
      .map((match) => ({ from: match.from, to: match.to, insert: replaceText }));
    view.dispatch({ changes });
    refreshDocumentSearch();
    view.focus();
  }

  function handleSearchInputKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeDocumentSearch();
      return;
    }

    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    moveDocumentSearch(event.shiftKey ? -1 : 1);
  }

  function handleReplaceInputKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeDocumentSearch();
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      replaceCurrentSearchMatch();
    }
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.key !== "Escape") {
      return;
    }

    closeEditorContextMenu();
    if (searchOpen) {
      closeDocumentSearch();
    }
  }

  function openEditorContextMenu(event: MouseEvent) {
    if (!view) {
      return;
    }

    const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (position === null) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    openEditorContextMenuAt(position, event.clientX, event.clientY);
  }

  function openEditorContextMenuAt(position: number, x: number, y: number) {
    if (!view) {
      return;
    }

    const selection = view.state.selection.main;
    const contextSelection = editorContextMenuSelection(position, selection);
    let task: TaskKeywordAtPosition | null = null;
    let link: ContextMenuLink | null = null;

    if (mode === "live-preview") {
      task = taskKeywordAtDocumentPosition(view.state, position, taskStates);
    }

    const wikiLink = wikiLinkAtDocumentPosition(view.state, position);
    if (wikiLink) {
      const resolved = resolveWikiTarget(wikiLink.target, pages);
      link = {
        link: wikiLink,
        resolvedPath: resolved?.path ?? null,
        resolvedExists: resolved?.exists ?? false,
      };
    }

    const kind = editorContextMenuKind(position, selection, Boolean(link), Boolean(task));

    if (!contextSelection) {
      view.dispatch({ selection: { anchor: position } });
    }

    imageContextMenu = null;
    editorContextMenu = {
      kind,
      x,
      y,
      line: view.state.doc.lineAt(position).number,
      selection: contextSelection,
      task,
      link,
    };
  }

  function handleEditorContextMenuKey(event: KeyboardEvent) {
    if (!view || (event.key !== "ContextMenu" && !(event.key === "F10" && event.shiftKey))) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const selection = view.state.selection.main;
    const position = selection.empty ? selection.head : Math.min(selection.head, selection.to - 1);
    const coordinates = view.coordsAtPos(position);
    const fallback = host.getBoundingClientRect();
    openEditorContextMenuAt(
      position,
      coordinates?.left ?? fallback.left + 12,
      coordinates?.bottom ?? fallback.top + 12,
    );
  }

  function openImageContextMenu(event: MouseEvent, image: HTMLImageElement) {
    event.preventDefault();
    event.stopPropagation();
    editorContextMenu = null;
    imageContextMenu = { x: event.clientX, y: event.clientY, image };
  }

  function handleEditorMouseDown(event: MouseEvent) {
    if (isBlockFoldMarkerEvent(event)) {
      event.preventDefault();
      event.stopPropagation();
      suppressCheckboxClick = false;
      suppressWikiLinkClick = false;
      return;
    }

    suppressCheckboxClick = toggleCheckboxFromPointerEvent(event);
    if (suppressCheckboxClick) {
      suppressWikiLinkClick = false;
      return;
    }

    suppressWikiLinkClick = openWikiLinkFromPointerEvent(event);
  }

  function handleEditorClick(event: MouseEvent) {
    if (toggleBlockFoldFromPointerEvent(event)) {
      suppressCheckboxClick = false;
      suppressWikiLinkClick = false;
      return;
    }

    if (suppressWikiLinkClick) {
      event.preventDefault();
      event.stopPropagation();
      suppressWikiLinkClick = false;
      return;
    }

    if (suppressCheckboxClick) {
      event.preventDefault();
      event.stopPropagation();
      suppressCheckboxClick = false;
      return;
    }

    toggleCheckboxFromPointerEvent(event);
  }

  function isBlockFoldMarkerEvent(event: MouseEvent) {
    return Boolean((event.target as HTMLElement | null)?.closest(".cm-block-fold-marker"));
  }

  function toggleBlockFoldFromPointerEvent(event: MouseEvent) {
    if (!view || !isBlockFoldMarkerEvent(event)) {
      return false;
    }

    event.preventDefault();
    event.stopPropagation();
    const block = view.lineBlockAtHeight(event.clientY - view.documentTop);
    const lineNumber = view.state.doc.lineAt(block.from).number;
    if (foldedBlockAtLine(view.state, lineNumber)) {
      expandBlock(view, lineNumber);
    } else {
      collapseBlock(view, lineNumber);
    }
    view.focus();
    return true;
  }

  function openWikiLinkFromPointerEvent(event: MouseEvent) {
    if (!view || mode !== "live-preview" || disabled || event.button !== 0) {
      return false;
    }

    const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (position === null) {
      return false;
    }

    const link = wikiLinkAtDocumentPosition(view.state, position);
    if (!link) {
      return false;
    }

    if (activeBlockLineNumbers(view.state).has(view.state.doc.lineAt(position).number)) {
      return false;
    }

    const resolved = resolveWikiTarget(link.target, pages);
    if (!resolved?.exists) {
      return false;
    }

    event.preventDefault();
    event.stopPropagation();
    closeEditorContextMenu();
    onOpenWikiLink(resolved.path, "editor");
    return true;
  }

  function toggleCheckboxFromPointerEvent(event: MouseEvent) {
    if (!view || mode !== "live-preview" || disabled || event.button !== 0) {
      return false;
    }

    const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (position === null) {
      return false;
    }

    const checkbox = checkboxAtDocumentPosition(view.state, position);
    if (!checkbox) {
      return false;
    }

    event.preventDefault();
    event.stopPropagation();
    view.dispatch({
      changes: {
        from: checkbox.from,
        to: checkbox.to,
        insert: checkbox.checked ? "[ ]" : "[x]",
      },
      selection: { anchor: checkbox.from },
    });
    view.focus();
    return true;
  }

  function setTaskStatus(nextStatus: string) {
    if (!view || disabled || !editorContextMenu?.task) {
      return;
    }

    const currentStatus = editorContextMenu.task.status;
    view.dispatch({
      changes: {
        from: editorContextMenu.task.from,
        to: editorContextMenu.task.to,
        insert: nextStatus,
      },
      selection: { anchor: editorContextMenu.task.from + nextStatus.length },
    });
    view.focus();
    closeEditorContextMenu();
    if (nextStatus !== currentStatus) {
      playTaskDoneSound(nextStatus, taskStates, taskDoneSoundEnabled);
    }
  }

  function setTaskPriority(nextPriority: string | null) {
    if (!view || disabled || !editorContextMenu?.task) {
      return;
    }

    const line = view.state.doc.lineAt(editorContextMenu.task.from);
    const change = taskPriorityChange(line.text, line.from, nextPriority, taskStates);
    if (!change) {
      closeEditorContextMenu();
      return;
    }

    view.dispatch({
      changes: change,
      selection: { anchor: change.from + change.insert.length },
    });
    view.focus();
    closeEditorContextMenu();
  }

  function currentTaskPriority() {
    if (!view || !editorContextMenu?.task) {
      return null;
    }

    const line = view.state.doc.lineAt(editorContextMenu.task.from);
    return priorityCookieMatch(line.text, line.from, taskStates)?.priority ?? null;
  }

  function playDoneSoundForStatus(nextStatus: string) {
    playTaskDoneSound(nextStatus, taskStates, taskDoneSoundEnabled);
  }

  function openWikiLinkInRightPane() {
    if (!editorContextMenu?.link?.resolvedPath || !editorContextMenu.link.resolvedExists) {
      return;
    }

    const path = editorContextMenu.link.resolvedPath;
    closeEditorContextMenu();
    onOpenWikiLink(path, "right");
  }

  function requestMissingWikiLinkPage() {
    if (!editorContextMenu?.link?.resolvedPath || editorContextMenu.link.resolvedExists) {
      return;
    }

    const path = editorContextMenu.link.resolvedPath;
    closeEditorContextMenu();
    onMissingWikiLink(path);
  }

  function openSourceLineInRightPane() {
    if (!editorContextMenu) {
      return;
    }

    const { line } = editorContextMenu;
    closeEditorContextMenu();
    onOpenSourceLineInRightPane(line);
  }

  function contextSelectionText() {
    if (!view || !editorContextMenu?.selection) {
      return "";
    }
    return view.state.sliceDoc(editorContextMenu.selection.from, editorContextMenu.selection.to);
  }

  function copyContextSelection(cut: boolean) {
    if (!view || !editorContextMenu?.selection) {
      return;
    }

    const editorView = view;
    const range = editorContextMenu.selection;
    const text = editorView.state.sliceDoc(range.from, range.to);
    closeEditorContextMenu();
    editorView.focus();
    void runUserAction(cut ? "Cut text" : "Copy text", async () => {
      await writeText(text);
      if (
        cut &&
        !disabled &&
        view === editorView &&
        editorView.state.selection.main.from === range.from &&
        editorView.state.selection.main.to === range.to &&
        editorView.state.sliceDoc(range.from, range.to) === text
      ) {
        editorView.dispatch({
          changes: { from: range.from, to: range.to },
          selection: { anchor: range.from },
          scrollIntoView: true,
        });
      }
      editorView.focus();
    });
  }

  function pasteFromClipboard() {
    if (!view || disabled) {
      return;
    }

    const editorView = view;
    const pastedIntoPath = documentPath;
    closeEditorContextMenu();
    editorView.focus();
    void runUserAction("Paste clipboard content", async () => {
      let clipboardImage: Awaited<ReturnType<typeof readImage>> | null = null;
      try {
        clipboardImage = await readImage();
      } catch {
        // The clipboard may contain text instead of an image.
      }

      if (clipboardImage) {
        try {
          const imageFile = await clipboardImageToPngFile(clipboardImage);
          if (view !== editorView || documentPath !== pastedIntoPath || !pastedIntoPath || disabled) {
            return;
          }
          const pasteId = beginImagePaste(editorView);
          await persistPastedImage(editorView, pastedIntoPath, pasteId, imageFile);
        } finally {
          await clipboardImage.close();
        }
        return;
      }

      const text = await readText();
      if (view !== editorView || disabled || text.length === 0) {
        editorView.focus();
        return;
      }
      const selection = editorView.state.selection.main;
      editorView.dispatch({
        changes: { from: selection.from, to: selection.to, insert: text },
        selection: { anchor: selection.from + text.length },
        scrollIntoView: true,
      });
      editorView.focus();
    });
  }

  function selectAllEditorText() {
    if (!view) {
      return;
    }
    const editorView = view;
    closeEditorContextMenu();
    editorView.dispatch({ selection: { anchor: 0, head: editorView.state.doc.length } });
    editorView.focus();
  }

  function copyContextWikiLink() {
    if (!view || !editorContextMenu?.link) {
      return;
    }
    const link = editorContextMenu.link.link;
    const markdown = view.state.sliceDoc(link.from, link.to);
    closeEditorContextMenu();
    view.focus();
    void runUserAction("Copy wiki link", () => writeText(markdown));
  }

  function canLinkContextSelection() {
    const text = contextSelectionText();
    return (
      editorContextMenu?.kind === "selection" &&
      text.length > 0 &&
      text.trim() === text &&
      !/[\[\]\r\n|]/.test(text) &&
      resolveWikiTarget(text, pages) !== null
    );
  }

  function linkContextSelection() {
    if (!view || !editorContextMenu?.selection || !canLinkContextSelection()) {
      return;
    }
    const editorView = view;
    const { from, to } = editorContextMenu.selection;
    const linked = `[[${editorView.state.sliceDoc(from, to)}]]`;
    editorView.dispatch({
      changes: { from, to, insert: linked },
      selection: { anchor: from + linked.length },
      scrollIntoView: true,
    });
    closeEditorContextMenu();
    editorView.focus();
  }

  function currentSourceLineBlockIsList() {
    if (!view || !editorContextMenu) {
      return false;
    }
    return blockRangeForCursorLine(editorDocumentLines(), editorContextMenu.line).isList;
  }

  function currentSourceLineBlockCanOutdent() {
    if (!view || !editorContextMenu) {
      return false;
    }
    return blockRangeForCursorLine(editorDocumentLines(), editorContextMenu.line).indent > 0;
  }

  function currentSourceLineBlockCanMove(direction: "up" | "down") {
    if (!view || !editorContextMenu || editorContextMenu.selection) {
      return false;
    }
    return Boolean(movableBlockRanges(editorDocumentLines(), editorContextMenu.line, direction));
  }

  function editorDocumentLines() {
    return view?.state.doc.toString().split("\n") ?? [];
  }

  function runContextEditorCommand(command: Command) {
    if (!view || disabled) {
      return;
    }
    const editorView = view;
    closeEditorContextMenu();
    command(editorView);
    editorView.focus();
  }

  function currentSourceLineBlockIsCollapsible() {
    return Boolean(
      view &&
        editorContextMenu &&
        collapsibleBlockAtLine(view.state, editorContextMenu.line),
    );
  }

  function currentSourceLineBlockIsFolded() {
    return Boolean(
      view &&
        editorContextMenu &&
        foldedBlockAtLine(view.state, editorContextMenu.line),
    );
  }

  function toggleSourceLineBlockFold() {
    if (!view || !editorContextMenu) {
      return;
    }

    const { line } = editorContextMenu;
    if (foldedBlockAtLine(view.state, line)) {
      expandBlock(view, line);
    } else {
      collapseBlock(view, line);
    }

    closeEditorContextMenu();
    view.focus();
  }

  function handleCollapseBelowLevelEvent(event: Event) {
    if (!view || !(event instanceof CustomEvent)) {
      return;
    }

    const level = Number(event.detail?.level);
    if (!Number.isInteger(level) || level < 1) {
      return;
    }

    collapseAllBlocksBelowLevel(view, level);
    view.focus();
  }

  function handleExpandAllBlocksEvent() {
    if (!view) {
      return;
    }

    expandAllBlockFolds(view);
    view.focus();
  }

  function closeEditorContextMenu() {
    editorContextMenu = null;
    imageContextMenu = null;
  }

  function closeEditorContextMenuAndFocus() {
    closeEditorContextMenu();
    view?.focus();
  }

  function selectedFormatText() {
    return contextSelectionText();
  }

  function canFormatSelection(format: InlineMarkdownFormat) {
    return canApplyInlineMarkdownFormat(selectedFormatText(), format);
  }

  function applyFormatToSelection(format: InlineMarkdownFormat) {
    if (!view || !editorContextMenu?.selection) {
      return;
    }

    const { from, to } = editorContextMenu.selection;
    const formatted = applyInlineMarkdownFormat(view.state.sliceDoc(from, to), format);
    if (formatted === null) {
      return;
    }

    view.dispatch({
      changes: { from, to, insert: formatted },
      selection: { anchor: from, head: from + formatted.length },
      scrollIntoView: true,
    });
    closeEditorContextMenu();
    view.focus();
  }

  function revealLineInEditor(lineNumber: number) {
    if (!view || lineNumber < 1) {
      return;
    }

    ensureLineVisible(view, lineNumber);
    const line = view.state.doc.line(Math.min(lineNumber, view.state.doc.lines));

    view.dispatch({
      selection: { anchor: line.from },
      effects: [
        EditorView.scrollIntoView(line.from, { y: "center" }),
        highlightLineEffect.of(line.from),
      ],
    });
    view.focus();

    if (highlightTimer) {
      clearTimeout(highlightTimer);
    }

    highlightTimer = setTimeout(() => {
      view?.dispatch({ effects: highlightLineEffect.of(null) });
      highlightTimer = null;
    }, 1800);
  }

  function wikiLinkCompletionSource(context: CompletionContext): CompletionResult | null {
    const line = context.state.doc.lineAt(context.pos);
    const textBeforeCursor = line.text.slice(0, context.pos - line.from);
    const match = matchWikiLinkCompletion(textBeforeCursor, context.pos);

    if (!match) {
      return null;
    }

    const suggestions = wikiLinkSuggestions(match.query, pages);
    if (suggestions.length === 0 && !context.explicit) {
      return null;
    }

    return {
      from: match.replacementFrom,
      options: suggestions.map((suggestion) => ({
        label: suggestion.label,
        type: "file",
        apply: wikiLinkCompletionApply(suggestion, match),
      })),
      filter: false,
    };
  }

  function handleEditorPaste(event: ClipboardEvent) {
    if (!view || disabled || !documentPath) {
      return false;
    }

    const imageFile = Array.from(event.clipboardData?.items ?? [])
      .filter((item) => item.kind === "file" && isSupportedClipboardImageType(item.type))
      .map((item) => item.getAsFile())
      .find((file): file is File => file !== null);
    if (!imageFile) {
      return false;
    }

    event.preventDefault();
    const editorView = view;
    const pastedIntoPath = documentPath;
    const pasteId = beginImagePaste(editorView);
    void persistPastedImage(editorView, pastedIntoPath, pasteId, imageFile);
    return true;
  }

  function beginImagePaste(editorView: EditorView) {
    const selection = editorView.state.selection.main;
    const pasteId = nextImagePasteId++;
    editorView.dispatch({
      effects: beginImagePasteEffect.of({
        id: pasteId,
        from: selection.from,
        to: selection.to,
      }),
      annotations: Transaction.addToHistory.of(false),
    });
    return pasteId;
  }

  async function persistPastedImage(
    editorView: EditorView,
    pastedIntoPath: string,
    pasteId: number,
    imageFile: File,
  ) {
    try {
      const bytes = new Uint8Array(await imageFile.arrayBuffer());
      const relativePath = await onPasteImage(pastedIntoPath, imageFile.type, bytes);
      if (view !== editorView || documentPath !== pastedIntoPath) {
        if (view === editorView) {
          editorView.dispatch({
            effects: finishImagePasteEffect.of(pasteId),
            annotations: Transaction.addToHistory.of(false),
          });
        }
        return;
      }

      const pending = editorView.state
        .field(pendingImagePastesField)
        .find((candidate) => candidate.id === pasteId);
      if (!pending) {
        return;
      }

      const markdownImage = pastedImageMarkdown(relativePath);
      editorView.dispatch({
        changes: { from: pending.from, to: pending.to, insert: markdownImage },
        selection: { anchor: pending.from + markdownImage.length },
        effects: finishImagePasteEffect.of(pasteId),
        scrollIntoView: true,
      });
      editorView.focus();
    } catch (error) {
      if (view === editorView && documentPath === pastedIntoPath) {
        editorView.dispatch({
          effects: finishImagePasteEffect.of(pasteId),
          annotations: Transaction.addToHistory.of(false),
        });
      }
      onPasteImageError(error);
    }
  }

  function editorExtensions() {
    return [
      lineNumbers(),
      blockFoldingExtension,
      history(),
      markdown(),
      EditorView.lineWrapping,
      listWrapIndentExtension,
      highlightLineField,
      searchDecorationsField,
      pendingImagePastesField,
      completions.of(autocompletion({ override: [wikiLinkCompletionSource] })),
      previewMode.of(
        mode === "live-preview"
          ? livePreviewExtension(
              taskStates,
              taskStateColors,
              pages,
              folderColors,
              openImageContextMenu,
            )
          : [],
      ),
      saveKeymap,
      blockKeys.of(blockEditingKeymap(taskStates, playDoneSoundForStatus)),
      keymap.of(defaultKeymap),
      EditorView.domEventHandlers({ paste: handleEditorPaste }),
      editable.of(EditorView.editable.of(!disabled)),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged || applyingExternalValue) {
          return;
        }

        onChange(update.state.doc.toString());
        if (
          !applyingHistoryCommand &&
          undoDepth(update.state) > undoDepth(update.startState)
        ) {
          onEditorHistoryChange(documentPath);
        }
        if (searchOpen) {
          queueMicrotask(refreshDocumentSearch);
        }
        emitEditorHistoryAvailability();
      }),
    ];
  }

  function createEditorState(doc: string) {
    return EditorState.create({
      doc,
      extensions: editorExtensions(),
    });
  }

  onMount(() => {
    window.addEventListener("logtext-editor-undo", handleEditorUndoEvent);
    window.addEventListener("logtext-editor-redo", handleEditorRedoEvent);
    window.addEventListener("logtext-editor-isolate-history", isolateEditorHistory);
    window.addEventListener("logtext-collapse-all-blocks-below-level", handleCollapseBelowLevelEvent);
    window.addEventListener("logtext-expand-all-blocks", handleExpandAllBlocksEvent);
    lastDocumentPath = documentPath;
    view = new EditorView({
      parent: host,
      state: createEditorState(value),
    });
    emitEditorHistoryAvailability();
  });

  $: if (view && documentPath !== lastDocumentPath) {
    onEditorHistoryDiscard(lastDocumentPath);
    lastDocumentPath = documentPath;
    applyingExternalValue = true;
    view.setState(createEditorState(value));
    emitEditorHistoryAvailability();
    if (searchOpen) {
      refreshDocumentSearch();
    }
    applyingExternalValue = false;
  }

  $: if (view && value !== view.state.doc.toString()) {
    applyingExternalValue = true;
    const change = minimalTextChange(view.state.doc.toString(), value);
    view.dispatch({
      changes: change ?? undefined,
      annotations: Transaction.addToHistory.of(false),
    });
    if (searchOpen) {
      refreshDocumentSearch();
    }
    applyingExternalValue = false;
    emitEditorHistoryAvailability();
  }

  $: if (view && revealLine && revealToken !== lastRevealToken) {
    lastRevealToken = revealToken;
    revealLineInEditor(revealLine);
  }

  $: if (view) {
    view.dispatch({
      effects: editable.reconfigure(EditorView.editable.of(!disabled)),
    });
  }

  $: if (view) {
    view.dispatch({
      effects: completions.reconfigure(autocompletion({ override: [wikiLinkCompletionSource] })),
    });
  }

  $: if (view) {
    view.dispatch({
      effects: previewMode.reconfigure(
        mode === "live-preview"
          ? livePreviewExtension(
              taskStates,
              taskStateColors,
              pages,
              folderColors,
              openImageContextMenu,
            )
          : [],
      ),
    });
  }

  $: if (view) {
    view.dispatch({
      effects: blockKeys.reconfigure(blockEditingKeymap(taskStates, playDoneSoundForStatus)),
    });
  }

  onDestroy(() => {
    window.removeEventListener("logtext-editor-undo", handleEditorUndoEvent);
    window.removeEventListener("logtext-editor-redo", handleEditorRedoEvent);
    window.removeEventListener("logtext-editor-isolate-history", isolateEditorHistory);
    window.removeEventListener(
      "logtext-collapse-all-blocks-below-level",
      handleCollapseBelowLevelEvent,
    );
    window.removeEventListener("logtext-expand-all-blocks", handleExpandAllBlocksEvent);
    if (highlightTimer) {
      clearTimeout(highlightTimer);
    }
    view?.destroy();
  });

  function handleEditorUndoEvent(event: Event) {
    if (event instanceof CustomEvent && typeof event.detail?.respond === "function") {
      const changed = undoCurrentDocument();
      emitEditorHistoryAvailability();
      event.detail.respond(changed);
      return;
    }

    undoCurrentDocument();
    emitEditorHistoryAvailability();
  }

  function handleEditorRedoEvent(event: Event) {
    if (event instanceof CustomEvent && typeof event.detail?.respond === "function") {
      const changed = redoCurrentDocument();
      emitEditorHistoryAvailability();
      event.detail.respond(changed);
      return;
    }

    redoCurrentDocument();
    emitEditorHistoryAvailability();
  }
</script>

<svelte:window
  on:click={closeEditorContextMenu}
  on:keydown={handleWindowKeydown}
/>

<div class="code-editor-shell">
  {#if searchOpen}
    <div class="editor-search-panel" role="search">
      <div class="editor-search-bar">
        <input
          bind:this={searchInput}
          bind:value={searchQuery}
          type="search"
          aria-label="Find in current document"
          placeholder="Find in document"
          on:input={() => {
            searchActiveIndex = 0;
            refreshDocumentSearch();
          }}
          on:keydown={handleSearchInputKeydown}
        />
        <span class="editor-search-count">
          {searchMatches.length === 0 ? "0/0" : `${searchActiveIndex + 1}/${searchMatches.length}`}
        </span>
        <button type="button" aria-label="Previous match" on:click={() => moveDocumentSearch(-1)}>
          Up
        </button>
        <button type="button" aria-label="Next match" on:click={() => moveDocumentSearch(1)}>
          Down
        </button>
        <button
          type="button"
          aria-expanded={replaceOpen}
          aria-controls="editor-replace-row"
          on:click={async () => {
            replaceOpen = !replaceOpen;
            if (replaceOpen) {
              await tick();
              replaceInput?.focus();
            }
          }}
        >
          Replace
        </button>
        <button type="button" aria-label="Close search" on:click={closeDocumentSearch}>Close</button>
      </div>
      {#if replaceOpen}
        <div id="editor-replace-row" class="editor-search-bar editor-replace-bar">
          <input
            bind:this={replaceInput}
            bind:value={replaceText}
            type="text"
            aria-label="Replace with"
            placeholder="Replace with"
            on:keydown={handleReplaceInputKeydown}
          />
          <button
            type="button"
            disabled={searchMatches.length === 0}
            on:click={replaceCurrentSearchMatch}
          >
            Replace
          </button>
          <button
            type="button"
            disabled={searchMatches.length === 0}
            on:click={replaceAllDocumentSearch}
          >
            All
          </button>
        </div>
      {/if}
    </div>
  {/if}

  <div
    class="code-editor"
    bind:this={host}
    role="textbox"
    aria-label="Markdown editor"
    aria-multiline="true"
    tabindex="-1"
    on:mousedown={handleEditorMouseDown}
    on:click={handleEditorClick}
    on:keydown={handleEditorContextMenuKey}
    on:contextmenu={openEditorContextMenu}
  ></div>
</div>

{#if imageContextMenu}
  <ImageContextMenu
    x={imageContextMenu.x}
    y={imageContextMenu.y}
    image={imageContextMenu.image}
    onClose={closeEditorContextMenuAndFocus}
  />
{/if}

{#if editorContextMenu}
  {@const blockIsList = currentSourceLineBlockIsList()}
  {@const blockIsCollapsible = currentSourceLineBlockIsCollapsible()}
  {@const blockIsFolded = currentSourceLineBlockIsFolded()}
  {@const blockCanOutdent = currentSourceLineBlockCanOutdent()}
  {@const blockCanMoveUp = currentSourceLineBlockCanMove("up")}
  {@const blockCanMoveDown = currentSourceLineBlockCanMove("down")}
  {@const currentPriority = currentTaskPriority()}
  {@const contextLink = editorContextMenu.link}
  {@const contextSelection = editorContextMenu.selection}
  <ContextMenuShell
    className="editor-link-menu"
    x={editorContextMenu.x}
    y={editorContextMenu.y}
    onClose={closeEditorContextMenuAndFocus}
  >
    {#if editorContextMenu.kind === "task" && editorContextMenu.task}
      <div class="editor-menu-flyout" role="menuitem" tabindex="0">
        <button
          type="button"
          class="editor-menu-flyout-trigger"
          data-menu-key="s"
          on:click|stopPropagation
        >
          <span><span class="menu-mnemonic">S</span>tatus</span>
          <span aria-hidden="true">›</span>
        </button>
        <div class="editor-menu-flyout-panel" role="menu">
          {#each taskStates as state, index}
            <button
              type="button"
              role="menuitem"
              data-menu-key={String(index + 1)}
              disabled={disabled || state === editorContextMenu.task.status}
              on:click={() => setTaskStatus(state)}
            >
              <span class="menu-mnemonic">{index + 1}</span> {state}
            </button>
          {/each}
        </div>
      </div>
      <div class="editor-menu-flyout" role="menuitem" tabindex="0">
        <button
          type="button"
          class="editor-menu-flyout-trigger"
          data-menu-key="y"
          on:click|stopPropagation
        >
          <span>Priorit<span class="menu-mnemonic">y</span></span>
          <span aria-hidden="true">›</span>
        </button>
        <div class="editor-menu-flyout-panel" role="menu">
          <button
            type="button"
            role="menuitem"
            data-menu-key="0"
            disabled={disabled || currentPriority === null}
            on:click={() => setTaskPriority(null)}
          >
            <span class="menu-mnemonic">0</span> No priority
          </button>
          {#each taskPriorityOptions as priority}
            <button
              type="button"
              role="menuitem"
              data-menu-key={priority}
              disabled={disabled || currentPriority === priority}
              on:click={() => setTaskPriority(priority)}
            >
              #<span class="menu-mnemonic">{priority}</span>
            </button>
          {/each}
        </div>
      </div>
    {/if}

    {#if editorContextMenu.kind === "link" && contextLink}
      <div class="editor-link-menu-title" title={contextLink.link.target}>
        {contextLink.link.label}
      </div>
      {#if contextLink.resolvedPath && contextLink.resolvedExists}
        <button
          type="button"
          role="menuitem"
          data-menu-key="r"
          on:click={openWikiLinkInRightPane}
        >
          Follow link in <span class="menu-mnemonic">r</span>ight pane
        </button>
      {/if}
      {#if contextLink.resolvedPath && !contextLink.resolvedExists}
        <button
          type="button"
          role="menuitem"
          data-menu-key="n"
          disabled={disabled}
          on:click={requestMissingWikiLinkPage}
        >
          Create <span class="menu-mnemonic">n</span>ew page
        </button>
      {/if}
      <button type="button" role="menuitem" data-menu-key="w" on:click={copyContextWikiLink}>
        Copy <span class="menu-mnemonic">w</span>iki link
      </button>
      <button
        type="button"
        role="menuitem"
        data-menu-key="s"
        on:click={openSourceLineInRightPane}
      >
        <span class="menu-mnemonic">S</span>how line in right pane
      </button>
    {/if}

    {#if editorContextMenu.kind === "selection" && contextSelection}
      <div class="editor-menu-flyout" role="menuitem" tabindex="0">
        <button
          type="button"
          class="editor-menu-flyout-trigger"
          data-menu-key="f"
          on:click|stopPropagation
        >
          <span><span class="menu-mnemonic">F</span>ormat</span>
          <span aria-hidden="true">›</span>
        </button>
        <div class="editor-menu-flyout-panel" role="menu">
          <button
            type="button"
            role="menuitem"
            data-menu-key="b"
            disabled={disabled}
            on:click={() => applyFormatToSelection("bold")}
          >
            <span class="menu-mnemonic">B</span>old
          </button>
          <button
            type="button"
            role="menuitem"
            data-menu-key="i"
            disabled={disabled}
            on:click={() => applyFormatToSelection("italic")}
          >
            <span class="menu-mnemonic">I</span>talic
          </button>
          <button
            type="button"
            role="menuitem"
            data-menu-key="s"
            disabled={disabled}
            on:click={() => applyFormatToSelection("strikethrough")}
          >
            <span class="menu-mnemonic">S</span>trikethrough
          </button>
          <button
            type="button"
            role="menuitem"
            data-menu-key="c"
            disabled={disabled || !canFormatSelection("inline-code")}
            on:click={() => applyFormatToSelection("inline-code")}
          >
            Inline <span class="menu-mnemonic">c</span>ode
          </button>
          <button
            type="button"
            role="menuitem"
            data-menu-key="l"
            disabled={disabled || !canLinkContextSelection()}
            on:click={linkContextSelection}
          >
            <span class="menu-mnemonic">L</span>ink selection as page
          </button>
        </div>
      </div>
    {/if}

    {#if blockIsList && editorContextMenu.kind !== "link" && editorContextMenu.kind !== "task"}
      <div class="editor-menu-flyout" role="menuitem" tabindex="0">
        <button
          type="button"
          class="editor-menu-flyout-trigger"
          data-menu-key="b"
          on:click|stopPropagation
        >
          <span><span class="menu-mnemonic">B</span>lock</span>
          <span aria-hidden="true">›</span>
        </button>
        <div class="editor-menu-flyout-panel" role="menu">
          {#if blockIsCollapsible}
            <button
              type="button"
              role="menuitem"
              data-menu-key={blockIsFolded ? "e" : "c"}
              disabled={disabled}
              on:click={toggleSourceLineBlockFold}
            >
              {#if blockIsFolded}
                <span class="menu-mnemonic">E</span>xpand block
              {:else}
                <span class="menu-mnemonic">C</span>ollapse block
              {/if}
            </button>
          {/if}
          <button
            type="button"
            class="context-menu-action"
            role="menuitem"
            data-menu-key="i"
            disabled={disabled}
            on:click={() => runContextEditorCommand(indentSelectedBlocks)}
          >
            <span><span class="menu-mnemonic">I</span>ndent</span>
            <span class="context-menu-shortcut" aria-hidden="true">Tab</span>
          </button>
          <button
            type="button"
            class="context-menu-action"
            role="menuitem"
            data-menu-key="o"
            disabled={disabled || !blockCanOutdent}
            on:click={() => runContextEditorCommand(outdentSelectedBlocks)}
          >
            <span><span class="menu-mnemonic">O</span>utdent</span>
            <span class="context-menu-shortcut" aria-hidden="true">Shift+Tab</span>
          </button>
          <button
            type="button"
            class="context-menu-action"
            role="menuitem"
            data-menu-key="u"
            disabled={disabled || !blockCanMoveUp}
            on:click={() => runContextEditorCommand(moveCurrentBlock("up"))}
          >
            <span>Move <span class="menu-mnemonic">u</span>p</span>
            <span class="context-menu-shortcut" aria-hidden="true">Ctrl+↑</span>
          </button>
          <button
            type="button"
            class="context-menu-action"
            role="menuitem"
            data-menu-key="d"
            disabled={disabled || !blockCanMoveDown}
            on:click={() => runContextEditorCommand(moveCurrentBlock("down"))}
          >
            <span>Move <span class="menu-mnemonic">d</span>own</span>
            <span class="context-menu-shortcut" aria-hidden="true">Ctrl+↓</span>
          </button>
        </div>
      </div>
    {/if}

    {#if editorContextMenu.kind !== "link"}
      <button
        type="button"
        role="menuitem"
        data-menu-key="r"
        on:click={openSourceLineInRightPane}
      >
        Show line in <span class="menu-mnemonic">r</span>ight pane
      </button>
    {/if}

    {#if editorContextMenu.kind !== "task"}
      <div class="context-menu-separator"></div>
      <button
        type="button"
        class="context-menu-action"
        role="menuitem"
        data-menu-key="t"
        disabled={disabled || !contextSelection}
        on:click={() => copyContextSelection(true)}
      >
        <span>Cu<span class="menu-mnemonic">t</span></span>
        <span class="context-menu-shortcut" aria-hidden="true">Ctrl+X</span>
      </button>
      <button
        type="button"
        class="context-menu-action"
        role="menuitem"
        data-menu-key="c"
        disabled={!contextSelection}
        on:click={() => copyContextSelection(false)}
      >
        <span><span class="menu-mnemonic">C</span>opy</span>
        <span class="context-menu-shortcut" aria-hidden="true">Ctrl+C</span>
      </button>
      <button
        type="button"
        class="context-menu-action"
        role="menuitem"
        data-menu-key="p"
        disabled={disabled}
        on:click={pasteFromClipboard}
      >
        <span><span class="menu-mnemonic">P</span>aste</span>
        <span class="context-menu-shortcut" aria-hidden="true">Ctrl+V</span>
      </button>
      <button
        type="button"
        class="context-menu-action"
        role="menuitem"
        data-menu-key="a"
        on:click={selectAllEditorText}
      >
        <span>Select <span class="menu-mnemonic">a</span>ll</span>
        <span class="context-menu-shortcut" aria-hidden="true">Ctrl+A</span>
      </button>
    {/if}
  </ContextMenuShell>
{/if}
