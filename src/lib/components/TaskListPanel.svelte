<script lang="ts">
  import { mainViewStore } from "../stores/mainView";
  import PaneVisibilityButton from "./PaneVisibilityButton.svelte";

  export let loading = false;
  export let taskCount = 0;
  export let toggleTaskOverview: () => void;
</script>

<section class="task-list-panel" aria-label="Tasks">
  <div class="navigator-section-heading">
    <span>Tasks</span>
    <div class="navigator-section-heading-actions">
      <small>{loading ? "..." : taskCount}</small>
      <PaneVisibilityButton pane="left" />
    </div>
  </div>
  <button type="button" class="task-overview-link" on:click={toggleTaskOverview}>
    {$mainViewStore === "tasks" ? "Show Editor" : "Show Task Overview"}
  </button>
</section>
