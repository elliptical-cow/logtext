import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { collapseLevelFromShortcut } from "../src/lib/keyboardShortcuts.js";

function shortcut(overrides: Partial<KeyboardEvent> = {}) {
  return {
    altKey: false,
    code: "",
    ctrlKey: false,
    isComposing: false,
    metaKey: false,
    shiftKey: false,
    ...overrides,
  } as KeyboardEvent;
}

test("recognizes layout-independent collapse level shortcuts", () => {
  assert.equal(collapseLevelFromShortcut(shortcut({ code: "Digit1", ctrlKey: true })), 1);
  assert.equal(collapseLevelFromShortcut(shortcut({ code: "Digit4", metaKey: true })), 4);
  assert.equal(collapseLevelFromShortcut(shortcut({ code: "Digit9", ctrlKey: true })), 9);
  assert.equal(
    collapseLevelFromShortcut(shortcut({ code: "Digit1", ctrlKey: true, key: "!" })),
    1,
  );
});

test("ignores shifted, modified, and out-of-range digit shortcuts", () => {
  assert.equal(
    collapseLevelFromShortcut(shortcut({ code: "Digit1", ctrlKey: true, shiftKey: true })),
    null,
  );
  assert.equal(
    collapseLevelFromShortcut(shortcut({ altKey: true, code: "Digit2", ctrlKey: true })),
    null,
  );
  assert.equal(collapseLevelFromShortcut(shortcut({ code: "Digit0", ctrlKey: true })), null);
  assert.equal(collapseLevelFromShortcut(shortcut({ code: "Numpad1", ctrlKey: true })), null);
  assert.equal(collapseLevelFromShortcut(shortcut({ code: "Digit1" })), null);
});

test("exposes collapse levels one through nine in the native View menu", () => {
  const nativeMenuSource = readFileSync(join(process.cwd(), "src-tauri/src/lib.rs"), "utf8");

  for (let level = 1; level <= 9; level += 1) {
    assert.equal(nativeMenuSource.includes(`"Level ${level}"`), true);
    assert.equal(nativeMenuSource.includes(`.accelerator("CmdOrCtrl+${level}")`), true);
    assert.equal(nativeMenuSource.includes(`"menu-collapse-blocks-below-level-${level}"`), true);
    assert.equal(nativeMenuSource.includes(`.item(&collapse_below_level_${level})`), true);
  }
});
