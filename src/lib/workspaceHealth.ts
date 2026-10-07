import type {
  WorkspaceHealthIssue,
  WorkspaceHealthIssueKind,
  WorkspaceHealthSeverity,
} from "./types.js";

export const workspaceHealthKindLabels: Record<WorkspaceHealthIssueKind, string> = {
  "page-key-collision": "Page name collisions",
  "missing-wiki-target": "Missing wiki-link targets",
  "missing-media": "Missing media",
  "unused-media": "Unreferenced media",
  "orphan-page": "Unlinked pages",
};

export function filterWorkspaceHealthIssues(
  issues: WorkspaceHealthIssue[],
  filters: { text: string; kind: WorkspaceHealthIssueKind | "all"; severity: WorkspaceHealthSeverity | "all" },
) {
  const query = filters.text.trim().toLocaleLowerCase();
  return issues.filter((issue) => {
    if (filters.kind !== "all" && issue.kind !== filters.kind) return false;
    if (filters.severity !== "all" && issue.severity !== filters.severity) return false;
    if (!query) return true;
    return [issue.path, issue.target, issue.message, issue.context]
      .filter(Boolean)
      .some((value) => value!.toLocaleLowerCase().includes(query));
  });
}

export function groupWorkspaceHealthIssues(issues: WorkspaceHealthIssue[]) {
  return Object.entries(workspaceHealthKindLabels)
    .map(([kind, label]) => ({
      kind: kind as WorkspaceHealthIssueKind,
      label,
      issues: issues.filter((issue) => issue.kind === kind),
    }))
    .filter((group) => group.issues.length > 0);
}
