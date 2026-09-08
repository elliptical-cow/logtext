import { convertFileSrc } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./api.js";

const externalImageScheme = /^(?:https?:|data:|blob:)/i;

export function resolveWorkspaceImagePath(
  sourceDocumentPath: string,
  markdownTarget: string,
): string | null {
  const target = decodeMarkdownTarget(markdownTarget.trim());
  if (!target || externalImageScheme.test(target) || target.startsWith("//")) {
    return null;
  }

  const workspaceRootRelative = target.startsWith("/");
  const resolved = workspaceRootRelative
    ? []
    : sourceDocumentPath.replace(/\\/g, "/").split("/").slice(0, -1);
  const targetPath = workspaceRootRelative ? target.slice(1) : target;

  for (const segment of targetPath.replace(/\\/g, "/").split("/")) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (resolved.length === 0) {
        return null;
      }
      resolved.pop();
      continue;
    }
    resolved.push(segment);
  }

  return resolved.length > 0 ? resolved.join("/") : null;
}

export function workspaceImageUrl(sourceDocumentPath: string, markdownTarget: string) {
  if (externalImageScheme.test(markdownTarget.trim())) {
    return markdownTarget;
  }

  const workspacePath = resolveWorkspaceImagePath(sourceDocumentPath, markdownTarget);
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

export function isWorkspaceImageTarget(sourceDocumentPath: string, markdownTarget: string) {
  return (
    !externalImageScheme.test(markdownTarget.trim()) &&
    resolveWorkspaceImagePath(sourceDocumentPath, markdownTarget) !== null
  );
}

function decodeMarkdownTarget(target: string) {
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}
