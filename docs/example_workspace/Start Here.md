# Start Here

This workspace follows Laura Stein as she turns a warehouse queue problem into a decision for [[meetings/Ops Steering]]. It is small enough to explore in about ten minutes.

When you open the workspace, Logtext creates today's journal in the middle editor and keeps this guide in the right pane. That is the intended starting point: capture in the middle, retain context on the right.

## 1. Capture today's work

Add this block to today's journal. Start each wiki link and choose the full path from autocomplete rather than typing the path completely.

```md
- Gate 4 follow-up
  - project:: [[projects/DockFlow Hamburg]]
  - owner:: [[people/Nadine Vogt]]
  - TODO [#A] Confirm the gate owner before [[meetings/Ops Steering]].
```

The task inherits `project` and `owner` from its parent block. Save with `Cmd/Ctrl+S`.

## 2. Keep writing while reviewing context

Place the cursor on the new task and press `Cmd/Ctrl+Alt+Right`. Logtext shows that exact line and its surrounding block in the right pane while the editor keeps focus.

- Press `F6` to move focus to the right pane and inspect the rendered context.
- Use `Alt+Left` while the right pane is focused to return to this guide.
- Use `Shift+F6` to move focus in the opposite direction.

If this guide is no longer visible, press `Cmd/Ctrl+P`, type `Start Here`, and use `Shift+Enter` to open it in the right pane again.

## 3. Follow links and backlinks

Press `Cmd/Ctrl+P`, search for `DockFlow`, and press `Enter` to open [[projects/DockFlow Hamburg]] in the editor. Its Linked References collect the dated journal notes that mention the project.

Tab to a backlink's `Edit` button and press `Enter` to return to the precise capture that created it. Then try Quick Open again with `Nadine` to see that matching uses both page names and full paths.

## 4. Review work across the workspace

Press `Cmd/Ctrl+Shift+T` to open Task Overview. The example is initially grouped by the inherited `owner` attribute.

- Type `gate` in the task search field.
- Tab through the remaining filters to the result list, then use `Up` or `Down` to select a task.
- Press `Enter` to show its source in the right pane or `E` to edit it.
- Press `Shift+F10` to open the task menu and change Status or Priority.

Clear the search and try the linked-page and attribute filters. Tasks in [[projects/DockFlow Hamburg]] and [[projects/SlotPilot]] inherit their context from parent blocks; journal tasks without an owner make missing metadata visible.

## 5. Explore rendered Markdown

Press `Cmd/Ctrl+P`, search for `Markdown Showcase`, and use `Shift+Enter` to open [[examples/Markdown Showcase]] in the right pane. It keeps tables, formulas, a Mermaid diagram, and interactive Markdown separate from the operational example.

## Useful ways to continue

- `Cmd/Ctrl+Shift+P` searches all available commands.
- `Cmd/Ctrl+Shift+F` focuses workspace search; `Down` enters the result list.
- The favorites provide quick access to this guide, the core project, the steering meeting, and the showcase.
- The dated journals tell the earlier story from first observation to steering decision.

The intended loop is simple: capture in the journal, connect with wiki links and attributes, review context through backlinks, and work through tasks without losing the source note.
