import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { get } from "svelte/store";
import { themeStore } from "../src/lib/stores/theme.js";

test("uses dark mode before a workspace preference is loaded", () => {
  assert.equal(get(themeStore), "dark");
});

test("switches repeatedly between light and dark mode", () => {
  themeStore.set("light");

  assert.equal(themeStore.toggle(), "dark");
  assert.equal(get(themeStore), "dark");
  assert.equal(themeStore.toggle(), "light");
  assert.equal(get(themeStore), "light");

  themeStore.set("dark");
});

test("marks the initial document as dark before the frontend starts", () => {
  const html = readFileSync(join(process.cwd(), "index.html"), "utf8");

  assert.match(html, /<html lang="en" data-theme="dark" style="color-scheme: dark">/);
});
