<script lang="ts">
  import { trapDialogFocus } from "../dialogFocus";
  import type { MediaCleanupCandidate } from "../types";

  export let candidates: MediaCleanupCandidate[] = [];
  export let scanning = false;
  export let moving = false;
  export let onCancel: () => void;
  export let onMoveToTrash: () => void;

  function cancel() {
    if (!moving) {
      onCancel();
    }
  }

  function formatFileSize(bytes: number) {
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KiB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  }
</script>

<div
  class="dialog-backdrop"
  role="presentation"
  on:mousedown={(event) => {
    if (event.currentTarget === event.target) {
      cancel();
    }
  }}
>
  <div
    class="about-dialog media-cleanup-dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby="media-cleanup-title"
    aria-describedby="media-cleanup-description"
    aria-busy={scanning || moving}
    tabindex="-1"
    use:trapDialogFocus={{ onClose: cancel }}
  >
    <header>
      <h2 id="media-cleanup-title">Clean Media</h2>
      <p id="media-cleanup-description">
        Unreferenced images can be moved to the operating system trash. Logtext never deletes
        them permanently.
      </p>
    </header>

    <div class="media-cleanup-body">
      {#if scanning}
        <p class="media-cleanup-status">Searching the workspace for media references…</p>
      {:else if candidates.length === 0}
        <p class="media-cleanup-status">No unreferenced images were found.</p>
      {:else}
        <p class="media-cleanup-summary">
          {candidates.length} unreferenced {candidates.length === 1 ? "image" : "images"} found:
        </p>
        <ul class="media-cleanup-list" aria-label="Unreferenced images">
          {#each candidates as candidate}
            <li>
              <span title={candidate.path}>{candidate.path}</span>
              <small>{formatFileSize(candidate.sizeBytes)}</small>
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    <footer>
      <button type="button" class="secondary-action" disabled={moving} on:click={cancel}>
        Cancel
      </button>
      <button
        type="button"
        class="primary-action"
        disabled={scanning || moving || candidates.length === 0}
        on:click={onMoveToTrash}
      >
        {moving ? "Moving…" : "Move to Trash"}
      </button>
    </footer>
  </div>
</div>
