<script lang="ts">
  import { trapDialogFocus } from "../dialogFocus";
  import type {
    PageSortMode,
    TaskColorName,
    WorkspacePreferences,
  } from "../types";
  import {
    normalizeWorkspacePreferences,
    validateWorkspacePreferences,
    workspacePreferencesEqual,
  } from "../workspacePreferences";

  export let root: string;
  export let folders: string[] = [];
  export let preferences: WorkspacePreferences;
  export let saveError: string | null = null;
  export let saveErrorDetail: string | null = null;
  export let onCancel: () => void;
  export let onSave: (preferences: WorkspacePreferences) => Promise<boolean>;

  const colors: TaskColorName[] = [
    "red",
    "yellow",
    "green",
    "blue",
    "grey",
    "orange",
    "pink",
  ];
  const sortOptions: Array<{ value: PageSortMode; label: string }> = [
    { value: "name-asc", label: "Name (A–Z)" },
    { value: "name-desc", label: "Name (Z–A)" },
    { value: "modified-desc", label: "Recently modified" },
    { value: "opened-desc", label: "Recently opened" },
  ];
  let draft: WorkspacePreferences = {
    ...preferences,
    taskStates: [...preferences.taskStates],
    taskStateColors: { ...preferences.taskStateColors },
  };
  let saving = false;

  $: errors = validateWorkspacePreferences(draft);
  $: valid = Object.keys(errors).length === 0;
  $: changed = !workspacePreferencesEqual(draft, preferences);

  function updateTaskState(index: number, value: string) {
    const previous = draft.taskStates[index];
    const taskStates = [...draft.taskStates];
    taskStates[index] = value;
    const taskStateColors = { ...draft.taskStateColors };
    taskStateColors[value] = taskStateColors[previous] ?? "grey";
    if (previous !== value) {
      delete taskStateColors[previous];
    }
    draft = { ...draft, taskStates, taskStateColors };
  }

  function updateTaskColor(state: string, color: TaskColorName) {
    draft = {
      ...draft,
      taskStateColors: { ...draft.taskStateColors, [state]: color },
    };
  }

  function addTaskState() {
    const base = "NEW_STATE";
    let state = base;
    let suffix = 2;
    while (draft.taskStates.includes(state)) {
      state = `${base}_${suffix++}`;
    }
    draft = {
      ...draft,
      taskStates: [...draft.taskStates, state],
      taskStateColors: { ...draft.taskStateColors, [state]: "grey" },
    };
  }

  function removeTaskState(index: number) {
    const state = draft.taskStates[index];
    const taskStates = draft.taskStates.filter((_, candidate) => candidate !== index);
    const taskStateColors = { ...draft.taskStateColors };
    delete taskStateColors[state];
    draft = { ...draft, taskStates, taskStateColors };
  }

  function moveTaskState(index: number, offset: -1 | 1) {
    const target = index + offset;
    if (target < 0 || target >= draft.taskStates.length) {
      return;
    }
    const taskStates = [...draft.taskStates];
    [taskStates[index], taskStates[target]] = [taskStates[target], taskStates[index]];
    draft = { ...draft, taskStates };
  }

  async function submit() {
    if (!valid || !changed || saving) {
      return;
    }
    saving = true;
    try {
      await onSave(normalizeWorkspacePreferences(draft));
    } finally {
      saving = false;
    }
  }
</script>

<div class="dialog-backdrop" role="presentation">
  <div
    class="preferences-dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby="preferences-title"
    tabindex="-1"
    use:trapDialogFocus={{ onClose: () => !saving && onCancel() }}
  >
    <form on:submit|preventDefault={submit}>
    <header>
      <h2 id="preferences-title">Preferences</h2>
      <p>Workspace settings in <code>{root}/.config</code></p>
    </header>

    <div class="preferences-body">
      {#if saveError}
        <div class="preferences-error" role="alert">
          <strong>{saveError}</strong>
          {#if saveErrorDetail}
            <details><summary>Technical details</summary><pre>{saveErrorDetail}</pre></details>
          {/if}
        </div>
      {/if}

      <section>
        <h3>General</h3>
        <label>
          <span>Theme</span>
          <select bind:value={draft.themeMode}>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <label>
          <span>Default page sort</span>
          <select bind:value={draft.defaultPageSort}>
            {#each sortOptions as option}
              <option value={option.value}>{option.label}</option>
            {/each}
          </select>
        </label>
        <p class="setting-note">Folder-specific sort orders remain available in the file tree.</p>
      </section>

      <section>
        <h3>Journal</h3>
        <label>
          <span>Journal folder</span>
          <input bind:value={draft.journalFolder} list="workspace-folders" spellcheck="false" />
        </label>
        {#if errors.journalFolder}<p class="field-error">{errors.journalFolder}</p>{/if}
        <label class="checkbox-setting">
          <input type="checkbox" bind:checked={draft.journalRightPaneContinuousScrolling} />
          <span>Continuous journal feed in the right pane</span>
        </label>
      </section>

      <section>
        <div class="section-heading">
          <h3>Tasks</h3>
          <button type="button" class="secondary-action compact-action" on:click={addTaskState}>
            Add state
          </button>
        </div>
        <p class="setting-note">The final state is treated as completed.</p>
        {#if errors.taskStates}<p class="field-error">{errors.taskStates}</p>{/if}
        <div class="task-state-list">
          {#each draft.taskStates as state, index}
            <div class="task-state-row">
              <input
                value={state}
                aria-label={`Task state ${index + 1}`}
                spellcheck="false"
                on:input={(event) => updateTaskState(index, event.currentTarget.value)}
              />
              <select
                value={draft.taskStateColors[state] ?? "grey"}
                aria-label={`Color for ${state || `task state ${index + 1}`}`}
                class="color-select"
                on:change={(event) =>
                  updateTaskColor(state, event.currentTarget.value as TaskColorName)}
              >
                {#each colors as color}
                  <option value={color}>{color}</option>
                {/each}
              </select>
              <span
                class="color-swatch"
                style={`--preference-color: var(--task-color-${draft.taskStateColors[state] ?? "grey"}-bg)`}
                aria-hidden="true"
              ></span>
              <button
                type="button"
                class="icon-action"
                aria-label={`Move ${state} up`}
                title="Move up"
                disabled={index === 0}
                on:click={() => moveTaskState(index, -1)}
              >↑</button>
              <button
                type="button"
                class="icon-action"
                aria-label={`Move ${state} down`}
                title="Move down"
                disabled={index === draft.taskStates.length - 1}
                on:click={() => moveTaskState(index, 1)}
              >↓</button>
              <button
                type="button"
                class="icon-action remove-action"
                aria-label={`Remove ${state}`}
                title="Remove state"
                disabled={draft.taskStates.length === 1}
                on:click={() => removeTaskState(index)}
              >×</button>
              {#if index === draft.taskStates.length - 1}
                <small>Completed state</small>
              {/if}
            </div>
          {/each}
        </div>
        <label class="checkbox-setting">
          <input type="checkbox" bind:checked={draft.taskDoneSoundEnabled} />
          <span>Play a sound when a task reaches the completed state</span>
        </label>
      </section>

      <section>
        <h3>Media</h3>
        <label>
          <span>Media folder</span>
          <input bind:value={draft.mediaFolder} list="workspace-folders" spellcheck="false" />
        </label>
        {#if errors.mediaFolder}<p class="field-error">{errors.mediaFolder}</p>{/if}
        <p class="setting-note">
          Existing files are not moved. New pasted images and Clean Media use this folder.
        </p>
      </section>

      <datalist id="workspace-folders">
        {#each folders as folder}<option value={folder}></option>{/each}
      </datalist>
    </div>

    <footer>
      <button type="button" class="secondary-action" disabled={saving} on:click={onCancel}>
        Cancel
      </button>
      <button type="submit" class="primary-action" disabled={!valid || !changed || saving}>
        {saving ? "Saving…" : "Save Preferences"}
      </button>
    </footer>
    </form>
  </div>
</div>

<style>
  .preferences-dialog {
    width: min(700px, calc(100vw - 32px));
    max-height: min(820px, calc(100vh - 32px));
    overflow: hidden;
    background: var(--surface-elevated);
    color: var(--text-primary);
    border: 1px solid var(--border-control);
    border-radius: 10px;
    box-shadow: 0 18px 55px rgb(0 0 0 / 28%);
  }

  .preferences-dialog > form {
    display: flex;
    max-height: inherit;
    flex-direction: column;
  }

  header, footer { padding: 16px 20px; }
  header { border-bottom: 1px solid var(--border-subtle); }
  header h2, section h3 { margin: 0; }
  header p { margin: 5px 0 0; color: var(--text-muted); }
  header code { font-size: 0.9em; overflow-wrap: anywhere; }
  footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    border-top: 1px solid var(--border-subtle);
  }
  footer button { min-width: 90px; }
  footer button {
    min-height: 32px;
    padding: 5px 12px;
    border: 1px solid var(--border-control);
    border-radius: 6px;
  }
  footer .secondary-action { color: var(--text-primary); background: var(--control-bg); }
  footer .primary-action {
    color: var(--control-primary-text);
    background: var(--control-primary-bg);
    border-color: var(--control-primary-bg);
  }
  footer button:hover:not(:disabled) { filter: brightness(0.96); }
  button:disabled { opacity: 0.55; }

  .preferences-body { padding: 0 20px 20px; overflow-y: auto; }
  section { padding: 18px 0; border-bottom: 1px solid var(--border-subtle); }
  section:last-of-type { border-bottom: 0; }
  section h3 { margin-bottom: 12px; font-size: 1rem; }
  section > label:not(.checkbox-setting) {
    display: grid;
    grid-template-columns: minmax(150px, 0.7fr) minmax(220px, 1.3fr);
    align-items: center;
    gap: 12px;
    margin-top: 10px;
  }
  input, select, button { font: inherit; }
  input:not([type="checkbox"]), select {
    box-sizing: border-box;
    width: 100%;
    min-height: 32px;
    padding: 5px 8px;
    color: var(--text-primary);
    background: var(--control-bg);
    border: 1px solid var(--border-control);
    border-radius: 5px;
  }
  .checkbox-setting { display: flex; align-items: center; gap: 8px; margin-top: 12px; }
  .checkbox-setting input { margin: 0; }
  .setting-note, .field-error { margin: 7px 0 0; font-size: 0.86rem; }
  .setting-note { color: var(--text-muted); }
  .field-error { color: var(--error-text, #b42318); }
  .section-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .compact-action { padding: 4px 9px; }
  .task-state-list { display: grid; gap: 7px; margin-top: 12px; }
  .task-state-row {
    display: grid;
    grid-template-columns: minmax(130px, 1fr) 105px 16px 30px 30px 30px;
    align-items: center;
    gap: 6px;
  }
  .task-state-row small { grid-column: 1 / -1; color: var(--text-muted); }
  .color-swatch {
    width: 12px;
    height: 12px;
    background: var(--preference-color);
    border: 1px solid var(--border-control);
    border-radius: 3px;
  }
  .icon-action {
    width: 30px;
    height: 30px;
    padding: 0;
    color: var(--text-muted);
    background: transparent;
    border: 1px solid var(--border-control);
    border-radius: 5px;
  }
  .icon-action:hover:not(:disabled) { color: var(--text-primary); background: var(--control-bg-hover); }
  .remove-action { font-size: 1.25rem; }
  .preferences-error {
    margin-top: 16px;
    padding: 10px 12px;
    color: var(--error-text, #b42318);
    background: var(--surface-pane-subtle);
    border: 1px solid currentColor;
    border-radius: 6px;
  }
  .preferences-error pre { white-space: pre-wrap; }

  @media (max-width: 560px) {
    section > label:not(.checkbox-setting), .task-state-row { grid-template-columns: 1fr; }
    .color-swatch { display: none; }
    .task-state-row small { grid-column: auto; }
  }
</style>
