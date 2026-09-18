import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { get } from "svelte/store";
import { themeStore } from "../src/lib/stores/theme.js";

test("uses dark mode before a workspace preference is loaded", () => {
  assert.equal(get(themeStore), "dark");
});

test("marks the initial document as dark before the frontend starts", () => {
  const html = readFileSync(join(process.cwd(), "index.html"), "utf8");

  assert.match(html, /<html lang="en" data-theme="dark" style="color-scheme: dark">/);
});
