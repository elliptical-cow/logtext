<script lang="ts">
  import type { WorkspacePane } from "../paneLayout";

  export let pane: WorkspacePane;
  export let expanded = true;

  $: paneLabel = pane;
  $: actionLabel = `${expanded ? "Collapse" : "Expand"} ${paneLabel} pane`;
  $: symbol = expanded ? "−" : "+";

  function togglePane() {
    window.dispatchEvent(
      new CustomEvent(`logtext-toggle-${pane}-pane`, {
        detail: { focusPaneControl: true },
      }),
    );
  }
</script>

<button
  type="button"
  class="pane-visibility-button"
  class:collapsed-pane-control={!expanded}
  title={actionLabel}
  aria-label={actionLabel}
  aria-expanded={expanded}
  data-pane-visibility-control={pane}
  data-pane-expanded={expanded}
  on:click={togglePane}
>
  <span aria-hidden="true">{symbol}</span>
</button>
