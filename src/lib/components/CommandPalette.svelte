<script lang="ts">
  import { onMount } from "svelte";
  import type { CommandDefinition, CommandId } from "../appCommands";
  import { commandShortcutLabel } from "../appCommands";
  import { trapDialogFocus } from "../dialogFocus";
  import { nextRovingIndex } from "../keyboardNavigation";
  import type { PageSummary } from "../types";

  export let mode: "commands" | "pages";
  export let commands: CommandDefinition[] = [];
  export let pages: PageSummary[] = [];
  export let onClose: () => void;
  export let onCommand: (id: CommandId) => void;
  export let onPage: (path: string, target: "editor" | "right") => void;

  let query = "";
  let activeIndex = 0;
  let input: HTMLInputElement | null = null;

  $: normalizedQuery = query.trim().toLocaleLowerCase();
  $: commandResults = commands.filter((command) =>
    `${command.category} ${command.title}`.toLocaleLowerCase().includes(normalizedQuery),
  );
  $: pageResults = pages
    .filter((page) => page.path.toLocaleLowerCase().includes(normalizedQuery))
    .sort((left, right) => pageScore(left.path, normalizedQuery) - pageScore(right.path, normalizedQuery))
    .slice(0, 50);
  $: resultCount = mode === "commands" ? commandResults.length : pageResults.length;
  $: if (activeIndex >= resultCount) activeIndex = Math.max(resultCount - 1, 0);
  $: activeId = resultCount > 0 ? `command-palette-option-${activeIndex}` : undefined;

  onMount(() => input?.focus());

  function pageScore(path: string, needle: string) {
    if (!needle) return 0;
    const lower = path.toLocaleLowerCase();
    const name = lower.split("/").at(-1) ?? lower;
    if (name.startsWith(needle)) return 0;
    if (lower.startsWith(needle)) return 1;
    return 2 + Math.max(lower.indexOf(needle), 0);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (resultCount === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      activeIndex = nextRovingIndex(activeIndex, resultCount, event.key) ?? activeIndex;
      scrollActiveOption();
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      activeIndex = nextRovingIndex(activeIndex, resultCount, event.key) ?? activeIndex;
      scrollActiveOption();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      selectActive(event.shiftKey ? "right" : "editor");
    }
  }

  function scrollActiveOption() {
    requestAnimationFrame(() => document.getElementById(`command-palette-option-${activeIndex}`)?.scrollIntoView({ block: "nearest" }));
  }

  function selectActive(target: "editor" | "right" = "editor") {
    if (mode === "commands") {
      const command = commandResults[activeIndex];
      if (command) onCommand(command.id);
      return;
    }
    const page = pageResults[activeIndex];
    if (page) onPage(page.path, target);
  }
</script>

<div class="dialog-backdrop command-palette-backdrop" role="presentation" on:mousedown={(event) => event.currentTarget === event.target && onClose()}>
  <div
    class="command-palette"
    role="dialog"
    aria-modal="true"
    aria-labelledby="command-palette-title"
    tabindex="-1"
    use:trapDialogFocus={{ onClose }}
  >
    <h2 id="command-palette-title">{mode === "commands" ? "Command Palette" : "Quick Open"}</h2>
    <input
      bind:this={input}
      bind:value={query}
      type="search"
      role="combobox"
      aria-label={mode === "commands" ? "Search commands" : "Search pages"}
      aria-controls="command-palette-results"
      aria-expanded="true"
      aria-activedescendant={activeId}
      autocomplete="off"
      placeholder={mode === "commands" ? "Type a command" : "Type a page name or path"}
      on:input={() => (activeIndex = 0)}
      on:keydown={handleKeydown}
    />
    <div id="command-palette-results" class="command-palette-results" role="listbox">
      {#if resultCount === 0}
        <p class="command-palette-empty">No matches</p>
      {:else if mode === "commands"}
        {#each commandResults as command, index}
          <button
            id={`command-palette-option-${index}`}
            type="button"
            role="option"
            aria-selected={index === activeIndex}
            tabindex="-1"
            class:active={index === activeIndex}
            on:mousemove={() => (activeIndex = index)}
            on:click={() => onCommand(command.id)}
          >
            <span><small>{command.category}</small>{command.title}</span>
            {#if commandShortcutLabel(command)}<kbd>{commandShortcutLabel(command)}</kbd>{/if}
          </button>
        {/each}
      {:else}
        {#each pageResults as page, index}
          <button
            id={`command-palette-option-${index}`}
            type="button"
            role="option"
            aria-selected={index === activeIndex}
            tabindex="-1"
            class:active={index === activeIndex}
            on:mousemove={() => (activeIndex = index)}
            on:click={() => onPage(page.path, "editor")}
          >
            <span>{page.path.replace(/\.md$/i, "")}</span>
            <small>Enter: editor · Shift+Enter: right pane</small>
          </button>
        {/each}
      {/if}
    </div>
  </div>
</div>

<style>
  .command-palette-backdrop {
    align-items: flex-start;
    padding-top: min(14vh, 120px);
  }

  .command-palette {
    width: min(680px, calc(100vw - 32px));
    max-height: min(620px, calc(100vh - 64px));
    overflow: hidden;
    border: 1px solid var(--border-control);
    border-radius: 10px;
    background: var(--surface-elevated);
    box-shadow: 0 20px 65px rgb(0 0 0 / 36%);
  }

  h2 {
    margin: 0;
    padding: 14px 16px 8px;
    font-size: 0.9rem;
    color: var(--text-muted);
  }

  input {
    width: calc(100% - 24px);
    margin: 0 12px 12px;
    padding: 10px 12px;
    border: 1px solid var(--border-control);
    border-radius: 6px;
    background: var(--control-bg);
    color: var(--text-primary);
    font: inherit;
  }

  input:focus {
    border-color: var(--accent-border);
    outline: 2px solid var(--accent-focus-ring);
  }

  .command-palette-results {
    max-height: 440px;
    overflow-y: auto;
    padding: 0 8px 8px;
  }

  button {
    display: flex;
    width: 100%;
    min-height: 42px;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 7px 9px;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: var(--text-primary);
    text-align: left;
  }

  button.active,
  button:hover {
    background: var(--accent-bg-selected);
  }

  button span {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  small {
    color: var(--text-muted);
    font-size: 0.75rem;
  }

  kbd {
    flex: none;
  }

  .command-palette-empty {
    margin: 0;
    padding: 16px;
    color: var(--text-muted);
  }
</style>
