import type { ThemeMode } from "./types.js";

export const MERMAID_DIAGRAM_SELECTOR = "[data-mermaid-diagram]";
export const MERMAID_SOURCE_SELECTOR = ".mermaid-diagram-source code";
export const MERMAID_OUTPUT_SELECTOR = ".mermaid-diagram-output";
export const MERMAID_ERROR_SELECTOR = ".mermaid-diagram-error";

type MermaidApi = {
  initialize(config: Record<string, unknown>): void;
  render(id: string, source: string): Promise<{ svg: string }>;
};

let mermaidPromise: Promise<MermaidApi> | null = null;
let renderQueue: Promise<void> = Promise.resolve();
let initializedTheme: ThemeMode | null = null;
let diagramSequence = 0;

export function mermaidConfiguration(theme: ThemeMode) {
  return {
    startOnLoad: false,
    securityLevel: "strict",
    htmlLabels: false,
    suppressErrorRendering: true,
    maxTextSize: 50_000,
    maxEdges: 500,
    theme: theme === "dark" ? "dark" : "default",
  } as const;
}

async function loadMermaid() {
  mermaidPromise ??= import("mermaid").then((module) => module.default as MermaidApi);
  return mermaidPromise;
}

export function renderMermaidDiagram(source: string, theme: ThemeMode): Promise<string> {
  const result = renderQueue.then(async () => {
    const mermaid = await loadMermaid();
    if (initializedTheme !== theme) {
      mermaid.initialize(mermaidConfiguration(theme));
      initializedTheme = theme;
    }

    diagramSequence += 1;
    const rendered = await mermaid.render(`logtext-mermaid-${diagramSequence}`, source);
    return rendered.svg;
  });

  renderQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export function mermaidRenderErrorMessage(error: unknown) {
  const detail = error instanceof Error ? error.message.split("\n")[0]?.trim() : "";
  return detail
    ? `Mermaid diagram could not be rendered: ${detail.slice(0, 240)}`
    : "Mermaid diagram could not be rendered.";
}
