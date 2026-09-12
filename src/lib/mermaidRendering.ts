import type { ThemeMode } from "./types.js";

export const MERMAID_DIAGRAM_SELECTOR = "[data-mermaid-diagram]";
export const MERMAID_SOURCE_SELECTOR = ".mermaid-diagram-source code";
export const MERMAID_OUTPUT_SELECTOR = ".mermaid-diagram-output";
export const MERMAID_ERROR_SELECTOR = ".mermaid-diagram-error";

type MermaidApi = {
  initialize(config: Record<string, unknown>): void;
  render(id: string, source: string): Promise<{ svg: string }>;
};

type MermaidCssRule = {
  readonly cssText: string;
};

type MermaidCssStyleSheet = {
  readonly cssRules: ArrayLike<MermaidCssRule>;
  insertRule(rule: string, index?: number): number;
  replaceSync?(cssText: string): void;
};

type MermaidCssStyleSheetConstructor = new () => MermaidCssStyleSheet;

export type MermaidCssStyleSheetEnvironment = {
  CSSStyleSheet?: MermaidCssStyleSheetConstructor;
  document?: {
    head?: {
      appendChild(element: MermaidStyleElement): unknown;
    };
    createElement(tagName: "style"): MermaidStyleElement;
  };
};

type MermaidStyleElement = {
  media: string;
  textContent: string | null;
  readonly sheet: MermaidCssStyleSheet | null;
  remove(): void;
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

function canConstructCssStyleSheet(constructor: MermaidCssStyleSheetConstructor | undefined) {
  if (!constructor) {
    return false;
  }

  try {
    const styleSheet = new constructor();
    styleSheet.insertRule(":root {}");
    return true;
  } catch {
    return false;
  }
}

export function installMermaidCssStyleSheetCompatibility(
  environment: MermaidCssStyleSheetEnvironment = globalThis as unknown as MermaidCssStyleSheetEnvironment,
) {
  const originalConstructor = environment.CSSStyleSheet;
  if (canConstructCssStyleSheet(originalConstructor)) {
    return () => {};
  }

  const styleDocument = environment.document;
  const documentHead = styleDocument?.head;
  if (!styleDocument || !documentHead) {
    throw new Error("This WebView does not support Mermaid stylesheet rendering.");
  }
  const compatibleDocument = styleDocument;
  const compatibleDocumentHead = documentHead;

  const temporaryStyleElements: MermaidStyleElement[] = [];
  // Older WebKit still provides a native stylesheet and CSS parser through a
  // style element, even though `new CSSStyleSheet()` throws.
  class MermaidCssStyleSheetFallback implements MermaidCssStyleSheet {
    private readonly styleElement: MermaidStyleElement;

    constructor() {
      this.styleElement = compatibleDocument.createElement("style");
      this.styleElement.media = "not all";
      compatibleDocumentHead.appendChild(this.styleElement);
      if (!this.styleElement.sheet) {
        this.styleElement.remove();
        throw new Error("This WebView does not support Mermaid stylesheet rendering.");
      }
      temporaryStyleElements.push(this.styleElement);
    }

    get cssRules() {
      return this.styleSheet.cssRules;
    }

    insertRule(rule: string, index?: number) {
      return this.styleSheet.insertRule(rule, index);
    }

    replaceSync(cssText: string) {
      this.styleElement.textContent = cssText;
    }

    private get styleSheet() {
      const styleSheet = this.styleElement.sheet;
      if (!styleSheet) {
        throw new Error("This WebView does not support Mermaid stylesheet rendering.");
      }
      return styleSheet;
    }
  }

  const fallbackConstructor = MermaidCssStyleSheetFallback as MermaidCssStyleSheetConstructor;
  const installed = Reflect.set(environment, "CSSStyleSheet", fallbackConstructor);
  if (!installed || environment.CSSStyleSheet !== fallbackConstructor) {
    throw new Error("This WebView does not support Mermaid stylesheet rendering.");
  }

  return () => {
    for (const styleElement of temporaryStyleElements) {
      styleElement.remove();
    }
    if (originalConstructor) {
      Reflect.set(environment, "CSSStyleSheet", originalConstructor);
    } else {
      Reflect.deleteProperty(environment, "CSSStyleSheet");
    }
  };
}

export function renderMermaidDiagram(source: string, theme: ThemeMode): Promise<string> {
  const result = renderQueue.then(async () => {
    const restoreCssStyleSheet = installMermaidCssStyleSheetCompatibility();
    try {
      const mermaid = await loadMermaid();
      if (initializedTheme !== theme) {
        mermaid.initialize(mermaidConfiguration(theme));
        initializedTheme = theme;
      }

      diagramSequence += 1;
      const rendered = await mermaid.render(`logtext-mermaid-${diagramSequence}`, source);
      return rendered.svg;
    } finally {
      restoreCssStyleSheet();
    }
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
