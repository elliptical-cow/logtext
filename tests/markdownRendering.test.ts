import assert from "node:assert/strict";
import test from "node:test";

import { renderCheckboxItems } from "../src/lib/markdownRendering.js";

test("renders markdown task list markers as clickable checkboxes", () => {
  assert.equal(
    renderCheckboxItems(
      "<ul>\n<li>[ ] Open task</li>\n<li>[x] Closed task</li>\n</ul>\n",
      "- [ ] Open task\n- [x] Closed task",
    ),
    '<ul>\n<li class="task-list-item"><input class="task-list-checkbox" type="checkbox" data-line="1" aria-label="Unchecked task" /> Open task</li>\n<li class="task-list-item"><input class="task-list-checkbox" type="checkbox" checked data-line="2" aria-label="Checked task" /> Closed task</li>\n</ul>\n',
  );
});

test("keeps checkbox source lines in rendered order when states are mixed", () => {
  assert.equal(
    renderCheckboxItems(
      "<ul>\n<li>[x] First</li>\n<li>[ ] Second</li>\n<li>[x] Third</li>\n</ul>\n",
      "- [x] First\n- [ ] Second\n- [x] Third",
    ),
    '<ul>\n<li class="task-list-item"><input class="task-list-checkbox" type="checkbox" checked data-line="1" aria-label="Checked task" /> First</li>\n<li class="task-list-item"><input class="task-list-checkbox" type="checkbox" data-line="2" aria-label="Unchecked task" /> Second</li>\n<li class="task-list-item"><input class="task-list-checkbox" type="checkbox" checked data-line="3" aria-label="Checked task" /> Third</li>\n</ul>\n',
  );
});

test("renders checkbox source lines from backlink line maps", () => {
  assert.equal(
    renderCheckboxItems(
      "<ul>\n<li>[ ] Parent</li>\n<li>[x] Child</li>\n</ul>\n",
      "- [ ] Parent\n  - [x] Child",
      [8, 13],
    ),
    '<ul>\n<li class="task-list-item"><input class="task-list-checkbox" type="checkbox" data-line="8" aria-label="Unchecked task" /> Parent</li>\n<li class="task-list-item"><input class="task-list-checkbox" type="checkbox" checked data-line="13" aria-label="Checked task" /> Child</li>\n</ul>\n',
  );
});

test("renders checkbox list items with source line attributes", () => {
  assert.equal(
    renderCheckboxItems(
      '<ul>\n<li data-source-line="8">[ ] Parent</li>\n<li data-source-line="13">[x] Child</li>\n</ul>\n',
      "- [ ] Parent\n- [x] Child",
      [8, 13],
    ),
    '<ul>\n<li data-source-line="8" class="task-list-item"><input class="task-list-checkbox" type="checkbox" data-line="8" aria-label="Unchecked task" /> Parent</li>\n<li data-source-line="13" class="task-list-item"><input class="task-list-checkbox" type="checkbox" checked data-line="13" aria-label="Checked task" /> Child</li>\n</ul>\n',
  );
});

test("keeps blockquote checkbox source lines aligned with rendered list items", () => {
  assert.equal(
    renderCheckboxItems(
      '<blockquote>\n<ul>\n<li data-source-line="1">[ ] Quoted</li>\n</ul>\n</blockquote>\n<ul>\n<li data-source-line="3">[ ] Normal</li>\n</ul>\n',
      "> - [ ] Quoted\n\n- [ ] Normal",
    ),
    '<blockquote>\n<ul>\n<li data-source-line="1" class="task-list-item"><input class="task-list-checkbox" type="checkbox" data-line="1" aria-label="Unchecked task" /> Quoted</li>\n</ul>\n</blockquote>\n<ul>\n<li data-source-line="3" class="task-list-item"><input class="task-list-checkbox" type="checkbox" data-line="3" aria-label="Unchecked task" /> Normal</li>\n</ul>\n',
  );
});

test("renders checkbox markers in loose list paragraphs", () => {
  assert.equal(
    renderCheckboxItems(
      '<ul>\n<li data-source-line="1">\n<p data-source-line="1">[ ] Loose</p>\n<p data-source-line="3">Continuation</p>\n</li>\n</ul>\n',
      "- [ ] Loose\n\n  Continuation",
    ),
    '<ul>\n<li data-source-line="1" class="task-list-item">\n<p data-source-line="1"><input class="task-list-checkbox" type="checkbox" data-line="1" aria-label="Unchecked task" /> Loose</p>\n<p data-source-line="3">Continuation</p>\n</li>\n</ul>\n',
  );
});
