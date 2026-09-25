<script lang="ts">
  import { tick } from "svelte";
  import type { Diagnostic } from "../types";
  import type { JournalDay } from "../journals";
  import DatePickerPopover from "./DatePickerPopover.svelte";
  import TaskListPanel from "./TaskListPanel.svelte";

  export let root: string | null = null;
  export let loading = false;
  export let diagnostics: Diagnostic[] = [];
  export let workspacePath = "";
  export let openWorkspace: () => void;
  export let chooseWorkspaceFolder: () => void;
  export let openJournal: (day: JournalDay) => void;
  export let openJournalDate: (date: string) => void | Promise<void>;
  export let taskLoading = false;
  export let taskCount = 0;
  export let toggleTaskOverview: () => void;

  let datePickerOpen = false;
  let pickerButton: HTMLButtonElement | null = null;

  function toggleDatePicker(event: MouseEvent) {
    event.stopPropagation();
    datePickerOpen = !datePickerOpen;
  }

  async function pickJournalDate(dateInput: string) {
    await openJournalDate(dateInput);
    datePickerOpen = false;
    await tick();
    pickerButton?.focus({ preventScroll: true });
  }

  function closeDatePicker(restoreFocus = true) {
    if (!datePickerOpen) return;
    datePickerOpen = false;
    if (restoreFocus) {
      void tick().then(() => pickerButton?.focus({ preventScroll: true }));
    }
  }
</script>

<div class="workspace-header">
  {#if !root}
    <div class="workspace-title">
      <p>Open a folder to begin</p>
    </div>
  {/if}
  {#if root}
    <TaskListPanel loading={taskLoading} {taskCount} {toggleTaskOverview} />
  {/if}
</div>

{#if !root}
  <form class="workspace-form" on:submit|preventDefault={openWorkspace}>
    <div class="workspace-row">
      <input
        id="workspace-path"
        bind:value={workspacePath}
        placeholder="/Users/jens/Documents/Notes"
        autocomplete="off"
      />
      <div class="workspace-actions">
        <button type="submit" disabled={loading}>
          {loading ? "Opening" : "Open"}
        </button>
        <button type="button" disabled={loading} on:click={chooseWorkspaceFolder}>
          Browse
        </button>
      </div>
    </div>
  </form>
{/if}

{#if root}
  <section class="journal-panel" aria-label="Journal">
    <div class="navigator-section-heading">
      <span>Journal</span>
    </div>
    <div class="journal-actions" aria-label="Journal shortcuts">
      <button type="button" title="Yesterday" on:click={() => openJournal("yesterday")}>-1d</button>
      <button type="button" title="Today" on:click={() => openJournal("today")}>Today</button>
      <button type="button" title="Tomorrow" on:click={() => openJournal("tomorrow")}>+1d</button>
      <div class="journal-date-picker">
        <button
          bind:this={pickerButton}
          type="button"
          title="Pick journal date"
          aria-haspopup="dialog"
          aria-expanded={datePickerOpen}
          aria-controls="journal-date-popover"
          on:pointerdown|stopPropagation
          on:click={toggleDatePicker}
        >Pick</button>
        {#if datePickerOpen}
          <DatePickerPopover
            id="journal-date-popover"
            label="Pick journal date"
            onSelect={pickJournalDate}
            onClose={closeDatePicker}
          />
        {/if}
      </div>
    </div>
  </section>
{/if}

{#if diagnostics.length > 0}
  <div class="diagnostics">
    {#each diagnostics as diagnostic}
      <div class="message warning">{diagnostic.message}</div>
    {/each}
  </div>
{/if}
