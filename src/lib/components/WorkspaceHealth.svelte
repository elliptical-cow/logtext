<script lang="ts">
  import { onMount } from "svelte";
  import { getWorkspaceHealth } from "../api";
  import { toErrorPresentation } from "../errors";
  import { linkOperations } from "../stores/linkOperations";
  import { workspaceStore } from "../stores/workspace";
  import type {
    WorkspaceHealthIssue,
    WorkspaceHealthIssueKind,
    WorkspaceHealthSeverity,
  } from "../types";
  import {
    filterWorkspaceHealthIssues,
    groupWorkspaceHealthIssues,
    workspaceHealthKindLabels,
  } from "../workspaceHealth";
  import ErrorDialog from "./ErrorDialog.svelte";
  import PaneVisibilityButton from "./PaneVisibilityButton.svelte";

  let issues: WorkspaceHealthIssue[] = [];
  let loading = false;
  let loaded = false;
  let textFilter = "";
  let kindFilter: WorkspaceHealthIssueKind | "all" = "all";
  let severityFilter: WorkspaceHealthSeverity | "all" = "all";
  let errorMessage: string | null = null;
  let errorDetail: string | null = null;

  $: filteredIssues = filterWorkspaceHealthIssues(issues, {
    text: textFilter,
    kind: kindFilter,
    severity: severityFilter,
  });
  $: groupedIssues = groupWorkspaceHealthIssues(filteredIssues);
  $: errorCount = issues.filter((issue) => issue.severity === "error").length;
  $: warningCount = issues.filter((issue) => issue.severity === "warning").length;
  $: infoCount = issues.filter((issue) => issue.severity === "info").length;

  onMount(() => {
    void refresh();
  });

  async function refresh() {
    loading = true;
    errorMessage = null;
    errorDetail = null;
    try {
      issues = (await getWorkspaceHealth()).issues;
      loaded = true;
    } catch (error) {
      const presentation = toErrorPresentation(error);
      errorMessage = presentation.message;
      errorDetail = presentation.detail;
    } finally {
      loading = false;
    }
  }

  function openSource(issue: WorkspaceHealthIssue) {
    if (!issue.path) return;
    void linkOperations.open(issue.path, "editor", { line: issue.line ?? undefined });
  }

  async function createMissingPage(issue: WorkspaceHealthIssue) {
    if (issue.kind !== "missing-wiki-target" || !issue.target) return;

    const created = await linkOperations.createAndOpen(issue.target, "right");
    if (!created) {
      errorMessage = $workspaceStore.error ?? "Could not create the missing page.";
      errorDetail = $workspaceStore.errorDetail;
      workspaceStore.clearError();
      return;
    }
    await refresh();
  }

  function sourceLabel(issue: WorkspaceHealthIssue) {
    if (!issue.path) return issue.target ?? "Workspace";
    return issue.line ? `${issue.path}:${issue.line}` : issue.path;
  }
</script>

<section class="workspace-health" aria-busy={loading}>
  <header class="workspace-health-header">
    <div>
      <h2>Workspace Health</h2>
      <small>{errorCount} errors · {warningCount} warnings · {infoCount} notes</small>
    </div>
    <div class="workspace-health-header-actions">
      <button type="button" on:click={refresh} disabled={loading}>
        {loading ? "Scanning..." : "Refresh"}
      </button>
      <PaneVisibilityButton pane="middle" expanded={true} />
    </div>
  </header>

  <div class="workspace-health-toolbar">
    <select bind:value={severityFilter} aria-label="Filter by severity">
      <option value="all">All severities</option>
      <option value="error">Errors</option>
      <option value="warning">Warnings</option>
      <option value="info">Notes</option>
    </select>
    <input bind:value={textFilter} type="search" placeholder="Filter diagnostics" aria-label="Filter diagnostics" />
    <select bind:value={kindFilter} aria-label="Filter by diagnostic type">
      <option value="all">All types</option>
      {#each Object.entries(workspaceHealthKindLabels) as [kind, label]}
        <option value={kind}>{label}</option>
      {/each}
    </select>
  </div>

  <div class="workspace-health-list" aria-live="polite">
    {#if loaded && issues.length === 0}
      <p class="workspace-health-empty">No workspace health issues found.</p>
    {:else if loaded && filteredIssues.length === 0}
      <p class="workspace-health-empty">No diagnostics match the current filters.</p>
    {/if}
    {#each groupedIssues as group}
      <section class="workspace-health-group">
        <header><strong>{group.label}</strong><small>{group.issues.length}</small></header>
        {#each group.issues as issue}
          <article class="workspace-health-row">
            <span class:health-error={issue.severity === "error"} class:health-warning={issue.severity === "warning"} class="workspace-health-severity">
              {issue.severity}
            </span>
            <div class="workspace-health-copy">
              <strong>{sourceLabel(issue)}</strong>
              <span>{issue.message}</span>
              {#if issue.context}<small>{issue.context}</small>{/if}
            </div>
            {#if issue.path || (issue.kind === "missing-wiki-target" && issue.target)}
              <div class="workspace-health-row-actions">
                {#if issue.path}
                  <button type="button" class="workspace-health-open" on:click={() => openSource(issue)}>Open</button>
                {/if}
                {#if issue.kind === "missing-wiki-target" && issue.target}
                  <button type="button" class="workspace-health-open" on:click={() => createMissingPage(issue)}>Create Page</button>
                {/if}
              </div>
            {/if}
          </article>
        {/each}
      </section>
    {/each}
  </div>
</section>

<ErrorDialog
  title="Workspace Health Error"
  message={errorMessage}
  detail={errorDetail}
  onClose={() => {
    errorMessage = null;
    errorDetail = null;
  }}
/>
