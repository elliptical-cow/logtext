import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { calendarDays, formatLocalDate } from "../src/lib/calendarDates.js";
import {
  matchSlashCommand,
  slashCommandsForQuery,
} from "../src/lib/slashCommands.js";

test("recognizes slash commands only at the start of block content", () => {
  assert.deepEqual(matchSlashCommand("/da", 3), {
    commandFrom: 0,
    queryFrom: 1,
    query: "da",
  });

  const listCommand = "  - /today";
  assert.deepEqual(matchSlashCommand(listCommand, listCommand.length), {
    commandFrom: 4,
    queryFrom: 5,
    query: "today",
  });

  const checkboxCommand = "- [ ] /date";
  assert.deepEqual(matchSlashCommand(checkboxCommand, checkboxCommand.length), {
    commandFrom: 6,
    queryFrom: 7,
    query: "date",
  });

  assert.equal(matchSlashCommand("note /date", 10), null);
  assert.equal(matchSlashCommand("/date later", 11), null);
  assert.equal(matchSlashCommand("https://example.com", 19), null);
});

test("filters registered slash commands by their typed prefix", () => {
  assert.deepEqual(
    slashCommandsForQuery("").map((command) => command.id),
    ["date", "today"],
  );
  assert.deepEqual(
    slashCommandsForQuery("DA").map((command) => command.id),
    ["date"],
  );
  assert.deepEqual(slashCommandsForQuery("missing"), []);
});

test("formats local dates and builds a Monday-first calendar grid", () => {
  const selected = new Date(2026, 8, 25);
  assert.equal(formatLocalDate(selected), "2026-09-25");

  const days = calendarDays(selected, selected);
  assert.equal(days.length, 42);
  assert.equal(days[0].date.getDay(), 1);
  assert.equal(days.find((day) => day.today)?.dateInput, "2026-09-25");
});

test("wires slash completions to the shared keyboard date picker", () => {
  const editor = readFileSync(
    join(process.cwd(), "src/lib/components/CodeMirrorEditor.svelte"),
    "utf8",
  );
  const picker = readFileSync(
    join(process.cwd(), "src/lib/components/DatePickerPopover.svelte"),
    "utf8",
  );

  assert.match(editor, /override: \[slashCommandCompletionSource, wikiLinkCompletionSource\]/);
  assert.match(editor, /formatLocalDate\(new Date\(\)\)/);
  assert.match(editor, /label="Insert date"/);
  assert.match(picker, /role="grid"/);
  assert.match(picker, /role="gridcell"/);
  assert.match(picker, /calendarDateForKey\(current, event\.key\)/);
});
