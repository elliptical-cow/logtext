import { katex } from "@mdit/plugin-katex";
import MarkdownIt from "markdown-it";
import { workspaceImageUrl } from "./mediaPaths.js";

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
      token.attrSet("src", workspaceImageUrl(sourcePath, target));
      token.attrSet("loading", "lazy");
      token.attrSet("class", "workspace-image");
      const altIndex = token.attrIndex("alt");
      if (altIndex >= 0) {
        token.attrs![altIndex][1] = renderer.renderInlineAsText(token.children ?? [], options, env);
      }
      return renderer.renderToken(tokens, index, options);
    };
  }

  return markdown;
}
