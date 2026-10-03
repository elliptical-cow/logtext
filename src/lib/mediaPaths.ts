/**
 * Validates Markdown image targets before creating workspace media URLs.
 *
 * URL conversion is not a security boundary by itself. Parent traversal,
 * absolute paths, platform prefixes, and external schemes are rejected before
 * the target reaches the backend's canonical-path checks.
 */

import { convertFileSrc } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./api.js";

const externalImageScheme = /^(?:https?:|data:|blob:)/i;

export function resolveWorkspaceImagePath(
  markdownTarget: string,
): string | null {
  const target = decodeMarkdownTarget(markdownTarget.trim());
  if (
    !target ||
    externalImageScheme.test(target) ||
    target.startsWith("/") ||
    target.startsWith("\\") ||
    /^[a-z]:[\\/]/i.test(target)
  ) {
    return null;
  }

  const resolved: string[] = [];
  for (const segment of target.replace(/\\/g, "/").split("/")) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      return null;
    }
    resolved.push(segment);
  }

  return resolved.length > 0 ? resolved.join("/") : null;
}

export function workspaceImageUrl(markdownTarget: string) {
  if (externalImageScheme.test(markdownTarget.trim())) {
    return markdownTarget;
  }

  const workspacePath = resolveWorkspaceImagePath(markdownTarget);
  if (!workspacePath) {
    return "about:blank#invalid-workspace-image";
  }

  if (typeof window !== "undefined" && isTauriRuntime()) {
    return convertFileSrc(workspacePath, "logtext-media");
  }

  return `logtext-media://localhost/${workspacePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;
}

export function isWorkspaceImageTarget(markdownTarget: string) {
  return (
    !externalImageScheme.test(markdownTarget.trim()) &&
    resolveWorkspaceImagePath(markdownTarget) !== null
  );
}

function decodeMarkdownTarget(target: string) {
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}
