import { katex } from "@mdit/plugin-katex";
import MarkdownIt from "markdown-it";
import {
  imageTitleWithoutLogtextWidth,
  logtextImageWidth,
} from "./imageSizing.js";
import { isWorkspaceImageTarget, workspaceImageUrl } from "./mediaPaths.js";

type MarkdownRendererOptions = {
  breaks: boolean;
  workspaceImages?: boolean;
};

export function createMarkdownRenderer({ breaks, workspaceImages = false }: MarkdownRendererOptions) {
  const markdown = new MarkdownIt({
    breaks,
    html: false,
    linkify: true,
  }).use(katex, {
    delimiters: "dollars",
    throwOnError: false,
    trust: false,
  });

  if (workspaceImages) {
    markdown.renderer.rules.image = (tokens, index, options, env, renderer) => {
      const token = tokens[index];
      const sourcePath = typeof env.sourcePath === "string" ? env.sourcePath : "";
      const target = token.attrGet("src") ?? "";
      const title = token.attrGet("title");
      const configuredWidth = logtextImageWidth(title);
      token.attrSet("src", workspaceImageUrl(sourcePath, target));
      token.attrSet("loading", "lazy");
      token.attrSet("class", "workspace-image");
      if (isWorkspaceImageTarget(sourcePath, target)) {
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
        token.attrs![altIndex][1] = renderer.renderInlineAsText(token.children ?? [], options, env);
      }
      return renderer.renderToken(tokens, index, options);
    };
  }

  return markdown;
}
