import assert from "node:assert/strict";
import test from "node:test";

import { commandForKeyboardEvent, keyBindingMatches } from "../src/lib/appCommands.js";
import { nextFocusRegion } from "../src/lib/focusRegions.js";
import {
  calendarDateForKey,
  firstChildTreeIndex,
  nextRovingIndex,
  parentTreeIndex,
} from "../src/lib/keyboardNavigation.js";

function keyEvent(overrides: Partial<KeyboardEvent> = {}) {
  return {
    altKey: false,
    ctrlKey: false,
    isComposing: false,
    key: "",
    metaKey: false,
    shiftKey: false,
    ...overrides,
  } as KeyboardEvent;
}

test("matches cross-platform command modifiers without accepting extra modifiers", () => {
  const binding = { key: "p", mod: true, shift: true, scope: "global", label: "" } as const;
  assert.equal(keyBindingMatches(binding, keyEvent({ key: "P", ctrlKey: true, shiftKey: true })), true);
  assert.equal(keyBindingMatches(binding, keyEvent({ key: "p", metaKey: true, shiftKey: true })), true);
  assert.equal(keyBindingMatches(binding, keyEvent({ key: "p", ctrlKey: true })), false);
  assert.equal(keyBindingMatches(binding, keyEvent({ key: "p", ctrlKey: true, shiftKey: true, altKey: true })), false);
});

test("recognizes global keyboard-first commands and ignores composition", () => {
  assert.equal(commandForKeyboardEvent(keyEvent({ key: "F6" }))?.id, "view.focusNextPane");
  assert.equal(commandForKeyboardEvent(keyEvent({ key: "F6", shiftKey: true }))?.id, "view.focusPreviousPane");
  assert.equal(commandForKeyboardEvent(keyEvent({ key: "p", metaKey: true }))?.id, "app.quickOpen");
  assert.equal(commandForKeyboardEvent(keyEvent({ key: "p", metaKey: true, isComposing: true })), null);
});

test("keeps editor line transfer distinct from pane history", () => {
  assert.equal(
    commandForKeyboardEvent(keyEvent({ key: "ArrowRight", ctrlKey: true, altKey: true }))?.id,
    "editor.openLineInRightPane",
  );
  assert.equal(
    commandForKeyboardEvent(keyEvent({ key: "ArrowRight", metaKey: true, altKey: true }))?.id,
    "editor.openLineInRightPane",
  );
  assert.equal(
    commandForKeyboardEvent(keyEvent({ key: "ArrowRight", altKey: true }))?.id,
    "view.historyForward",
  );
});

test("cycles only through visible focus regions", () => {
  assert.equal(nextFocusRegion("left", ["left", "middle", "right"], 1), "middle");
  assert.equal(nextFocusRegion("right", ["left", "right"], 1), "left");
  assert.equal(nextFocusRegion("left", ["left", "right"], -1), "right");
  assert.equal(nextFocusRegion(null, [], 1), null);
});

test("wraps roving list navigation and supports Home and End", () => {
  assert.equal(nextRovingIndex(2, 3, "ArrowDown"), 0);
  assert.equal(nextRovingIndex(0, 3, "ArrowUp"), 2);
  assert.equal(nextRovingIndex(1, 3, "Home"), 0);
  assert.equal(nextRovingIndex(1, 3, "End"), 2);
  assert.equal(nextRovingIndex(0, 0, "ArrowDown"), null);
});

test("finds tree parents and first visible children from row depths", () => {
  const depths = [0, 1, 2, 1, 0];
  assert.equal(parentTreeIndex(depths, 2), 1);
  assert.equal(parentTreeIndex(depths, 3), 0);
  assert.equal(parentTreeIndex(depths, 0), null);
  assert.equal(firstChildTreeIndex(depths, 0), 1);
  assert.equal(firstChildTreeIndex(depths, 3), null);
});

test("moves through calendar grids and clamps month changes", () => {
  const wednesday = new Date(2026, 8, 23);
  assert.equal(calendarDateForKey(wednesday, "ArrowLeft")?.getDate(), 22);
  assert.equal(calendarDateForKey(wednesday, "Home")?.getDate(), 21);
  assert.equal(calendarDateForKey(wednesday, "End")?.getDate(), 27);
  const marchEnd = calendarDateForKey(new Date(2026, 2, 31), "PageUp");
  assert.deepEqual(
    [marchEnd?.getFullYear(), marchEnd?.getMonth(), marchEnd?.getDate()],
    [2026, 1, 28],
  );
});
