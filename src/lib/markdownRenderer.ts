import { katex } from "@mdit/plugin-katex";
import MarkdownIt from "markdown-it";

type MarkdownRendererOptions = {
  breaks: boolean;
};

export function createMarkdownRenderer({ breaks }: MarkdownRendererOptions) {
  return new MarkdownIt({
    breaks,
    html: false,
    linkify: true,
  }).use(katex, {
    delimiters: "dollars",
    throwOnError: false,
    trust: false,
  });
}
