import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const markdownView = readFileSync(
  join(root, "src/lib/components/MarkdownView.svelte"),
  "utf8",
);
const rightPane = readFileSync(join(root, "src/lib/components/RightPane.svelte"), "utf8");
const journalFeed = readFileSync(
  join(root, "src/lib/components/JournalFeed.svelte"),
  "utf8",
);
const styles = readFileSync(join(root, "src/styles.css"), "utf8");

test("copies only a right-clicked rendered text selection", () => {
  assert.match(markdownView, /selectedRenderedTextAtPoint\(event\)/);
  assert.match(markdownView, /range\.getClientRects\(\)/);
  assert.match(markdownView, /writeText\(text\)/);
  assert.match(markdownView, /context-menu-shortcut[^>]*>Ctrl\+C<\/span>/);
  assert.match(rightPane, /enableTextCopyContextMenu/g);
  assert.match(journalFeed, /enableTextCopyContextMenu/g);
  assert.match(styles, /\.context-menu-shortcut\s*\{[^}]*color: var\(--text-faint\)/s);
});

test("keeps rendered task menus limited to status, priority, and editor navigation", () => {
  const taskMenu = markdownView.slice(markdownView.indexOf("{#if taskContextMenu}"));

  assert.match(taskMenu, /menu-mnemonic">S<\/span>tatus/);
  assert.match(taskMenu, /menu-mnemonic">P<\/span>riority/);
  assert.match(taskMenu, /Show line in <span class="menu-mnemonic">e<\/span>ditor/);
  assert.equal(/copyRenderedSelection|>Copy</.test(taskMenu), false);
  assert.match(markdownView, /on:click=\{showTaskSourceLineInEditor\}/);
  assert.match(rightPane, /onOpenSourceLineInEditor=\{openBacklinkLineInEditor\}/);
  assert.match(journalFeed, /onOpenSourceLineInEditor\(pageView\.page\.path, line\)/);
});
