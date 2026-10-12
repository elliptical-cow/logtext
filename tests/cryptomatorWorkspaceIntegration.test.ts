import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const source = (path: string) => readFileSync(join(root, path), "utf8");

test("wires Cryptomator open through the native menu, dialog, store, and typed API", () => {
  const backend = source("src-tauri/src/lib.rs");
  const events = source("src/lib/coreEvents.ts");
  const app = source("src/App.svelte");
  const dialog = source("src/lib/components/CryptomatorDialog.svelte");
  const workspace = source("src/lib/stores/workspace.ts");
  const api = source("src/lib/api.ts");

  assert.match(backend, /Open Cryptomator Vault/);
  assert.match(events, /menu-open-cryptomator/);
  assert.match(app, /<CryptomatorDialog/);
  assert.match(dialog, /probeCryptomatorCli/);
  assert.match(dialog, /onMount/);
  assert.match(dialog, /await chooseCli\(\)/);
  assert.match(dialog, /type="password"/);
  assert.match(dialog, /await onBeforeOpen\(\)/);
  assert.match(dialog, /closeFailedCryptomatorOpen/);
  assert.match(workspace, /openCryptomatorWorkspaceCommand/);
  assert.match(api, /invokeTauri<WorkspaceState>\("open_cryptomator_workspace"/);
});

test("keeps the last Cryptomator vault locked until an explicit user action", () => {
  const workspace = source("src/lib/stores/workspace.ts");

  assert.match(workspace, /workspace\.kind === "cryptomator"/);
  assert.match(workspace, /lockedVaultPath: workspace\.path/);
  assert.doesNotMatch(
    workspace,
    /workspace\.kind === "cryptomator"[\s\S]{0,180}openCryptomatorWorkspaceCommand/,
  );
});

test("shares one close workflow across menus, workspace replacement, and native app close", () => {
  const lifecycle = source("src/lib/workspaceLifecycle.ts");
  const events = source("src/lib/coreEvents.ts");
  const app = source("src/App.svelte");

  assert.match(events, /menu-close-workspace[\s\S]*closeActiveWorkspace\(false\)/);
  assert.match(events, /openWorkspaceFromDialog[\s\S]*closeActiveWorkspace\(false\)/);
  assert.match(app, /onCloseRequested/);
  assert.match(app, /closeActiveWorkspace\(true\)/);
  assert.match(lifecycle, /closeWorkspace\(false\)/);
  assert.match(lifecycle, /result\.status === "timedOut"/);
  assert.match(lifecycle, /result\.status === "unmountFailed"/);
  assert.match(lifecycle, /prepareEditorForClose\(workspace\.disconnected\)/);
  assert.match(lifecycle, /if \(disconnected\)[\s\S]*cannot be saved/);
});

test("keeps the current workspace open until the Cryptomator form is submitted", () => {
  const app = source("src/App.svelte");

  assert.match(app, /onBeforeOpen=\{prepareCryptomatorOpen\}/);
  assert.match(
    app,
    /function handleOpenCryptomatorRequest\(\) \{\s*showCryptomator = true;\s*\}/,
  );
  assert.match(
    app,
    /async function prepareCryptomatorOpen\(\) \{\s*return !\$workspaceStore\.root \|\| closeActiveWorkspace\(false\);/,
  );
});
