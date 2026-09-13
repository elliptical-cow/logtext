import { katex } from "@mdit/plugin-katex";
import MarkdownIt from "markdown-it";
import {
  imageTitleWithoutLogtextWidth,
  logtextImageWidth,
} from "./imageSizing.js";
import { isWorkspaceImageTarget, workspaceImageUrl } from "./mediaPaths.js";
import { sourceLineForLocalLine } from "./markdownSourceLines.js";
import {
  wikiLinkDisplayLabel,
  wikiLinkHref,
  wikiLinksInText,
  type WikiLinkMatch,
} from "./wikiLinks.js";
import type { PageSummary } from "./types.js";

type MarkdownRendererOptions = {
  breaks: boolean;
  workspaceImages?: boolean;
  mermaidCodeBlocks?: boolean;
  logtextWikiLinks?: boolean;
};

export function createMarkdownRenderer({
  breaks,
  workspaceImages = false,
  mermaidCodeBlocks = false,
  logtextWikiLinks = false,
}: MarkdownRendererOptions) {
  const markdown = new MarkdownIt({
    breaks,
    html: false,
    linkify: true,
  }).use(katex, {
    delimiters: "dollars",
    throwOnError: false,
    trust: false,
  });

  if (logtextWikiLinks) {
    const wikiLinksByInlineState = new WeakMap<object, Map<number, WikiLinkMatch>>();
    markdown.inline.ruler.before("link", "logtext_wiki_link", (state, silent) => {
      const candidate = state.src[state.pos];
      if (candidate !== "#" && state.src.slice(state.pos, state.pos + 2) !== "[[") {
        return false;
      }
      if ((state as typeof state & { linkLevel?: number }).linkLevel) {
        return false;
      }

      let linksByPosition = wikiLinksByInlineState.get(state);
      if (!linksByPosition) {
        linksByPosition = new Map(wikiLinksInText(state.src).map((link) => [link.from, link]));
        wikiLinksByInlineState.set(state, linksByPosition);
      }
      const match = linksByPosition.get(state.pos);
      if (!match) {
        return false;
      }

      const pages = Array.isArray(state.env?.pages) ? (state.env.pages as PageSummary[]) : [];
      const href = wikiLinkHref(match.target, pages);
      if (!href) {
        return false;
      }

      if (!silent) {
        const displayLabel = match.alias || wikiLinkDisplayLabel(match.target, pages);
        const label = match.syntax === "compact" ? `#${displayLabel}` : displayLabel;
        const open = state.push("link_open", "a", 1);
        open.attrSet("href", href);
        state.push("text", "", 0).content = label;
        state.push("link_close", "a", -1);
      }
      state.pos = match.to;
      return true;
    });
  }

  if (mermaidCodeBlocks) {
    const defaultFenceRenderer = markdown.renderer.rules.fence;
    markdown.renderer.rules.fence = (tokens, index, options, env, renderer) => {
      const token = tokens[index];
      const language = token.info.trim().split(/\s+/, 1)[0]?.toLowerCase();
      if (language !== "mermaid") {
        return defaultFenceRenderer
          ? defaultFenceRenderer(tokens, index, options, env, renderer)
          : renderer.renderToken(tokens, index, options);
      }

      const localLine = token.map?.[0];
      const sourceLine =
        localLine === undefined
          ? null
          : sourceLineForLocalLine(localLine + 1, env?.sourceLineNumbers);
      const lineAttribute = sourceLine === null ? "" : ` data-source-line="${sourceLine}"`;
      const source = markdown.utils.escapeHtml(token.content);
      return [
        `<div class="mermaid-diagram" data-mermaid-diagram${lineAttribute}>`,
        `<pre class="mermaid-diagram-source"><code class="language-mermaid">${source}</code></pre>`,
        '<div class="mermaid-diagram-output" hidden></div>',
        '<div class="mermaid-diagram-error" role="alert" hidden></div>',
        "</div>\n",
      ].join("");
    };
  }

  if (workspaceImages) {
    markdown.renderer.rules.image = (tokens, index, options, _env, renderer) => {
      const token = tokens[index];
      const target = token.attrGet("src") ?? "";
      const title = token.attrGet("title");
      const configuredWidth = logtextImageWidth(title);
      token.attrSet("src", workspaceImageUrl(target));
      token.attrSet("loading", "lazy");
      token.attrSet("class", "workspace-image");
      if (isWorkspaceImageTarget(target)) {
        token.attrSet("data-workspace-image", "true");
        token.attrSet("crossorigin", "anonymous");
      }
      if (configuredWidth !== null) {
        token.attrSet("style", `width: ${configuredWidth}px`);
        const visibleTitle = imageTitleWithoutLogtextWidth(title);
        const titleIndex = token.attrIndex("title");
        if (visibleTitle) {
          token.attrSet("title", visibleTitle);
        } else if (titleIndex >= 0) {
          token.attrs!.splice(titleIndex, 1);
        }
      }
      const altIndex = token.attrIndex("alt");
      if (altIndex >= 0) {
        token.attrs![altIndex][1] = renderer.renderInlineAsText(token.children ?? [], options, _env);
      }
      return renderer.renderToken(tokens, index, options);
    };
  }

  return markdown;
}

export function markdownCodeLineNumbers(markdown: MarkdownIt, source: string) {
  const lines = new Set<number>();

  for (const token of markdown.parse(source, {})) {
    if ((token.type !== "fence" && token.type !== "code_block") || !token.map) {
      continue;
    }

    for (let line = token.map[0]; line < token.map[1]; line += 1) {
      lines.add(line + 1);
    }
  }

  return lines;
}
