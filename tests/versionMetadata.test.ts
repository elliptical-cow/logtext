import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(join(root, path), "utf8")) as T;
}

test("keeps application versions in sync", () => {
  const packageJson = readJson<{ version: string }>("package.json");
  const tauriConfig = readJson<{ version: string }>("src-tauri/tauri.conf.json");
  const cargoToml = readFileSync(join(root, "src-tauri/Cargo.toml"), "utf8");

  assert.match(cargoToml, new RegExp(`^version = "${packageJson.version}"$`, "m"));
  assert.equal(tauriConfig.version, packageJson.version);
});

test("keeps application naming consistent across build metadata", () => {
  const packageJson = readJson<{ name: string }>("package.json");
  const tauriConfig = readJson<{
    productName: string;
    identifier: string;
    app: { windows: Array<{ title: string }> };
  }>("src-tauri/tauri.conf.json");
  const cargoToml = readFileSync(join(root, "src-tauri/Cargo.toml"), "utf8");
  const indexHtml = readFileSync(join(root, "index.html"), "utf8");

  assert.equal(packageJson.name, "logtext");
  assert.equal(tauriConfig.productName, "Logtext");
  assert.equal(tauriConfig.identifier, "dev.logtext.desktop");
  assert.equal(tauriConfig.app.windows[0]?.title, "Logtext");
  assert.match(cargoToml, /^name = "logtext"$/m);
  assert.match(cargoToml, /^default-run = "Logtext"$/m);
  assert.match(cargoToml, /^name = "Logtext"$/m);
  assert.match(cargoToml, /^name = "logtext_lib"$/m);
  assert.match(indexHtml, /<title>Logtext<\/title>/);
});

test("keeps the About dialog product name and repository link current", () => {
  const appSource = readFileSync(join(root, "src/App.svelte"), "utf8");

  assert.match(appSource, /<h2 id="about-dialog-title">Logtext<\/h2>/);
  assert.match(appSource, /https:\/\/github\.com\/elliptical-cow\/logtext/);
  assert.match(appSource, /A local Markdown-based knowledge workspace/);
});

test("gives the release publisher explicit repository context", () => {
  const releaseWorkflow = readFileSync(
    join(root, ".github/workflows/release.yml"),
    "utf8",
  );

  assert.match(
    releaseWorkflow,
    /gh release create[\s\S]*?--repo "\$GITHUB_REPOSITORY"/,
  );
});

test("uses explicit OS and architecture names for release assets", () => {
  const releaseWorkflow = readFileSync(
    join(root, ".github/workflows/release.yml"),
    "utf8",
  );

  for (const assetName of [
    "Logtext-${version}-windows-x86_64-portable.exe",
    "Logtext-${version}-windows-x86_64-setup.exe",
    "Logtext-${version}-macos-universal-app.zip",
    "Logtext-${version}-linux-x86_64.AppImage",
    "Logtext-${version}-linux-x86_64.deb",
    "Logtext-${version}-linux-x86_64-thin.tar.gz",
  ]) {
    assert.equal(releaseWorkflow.includes(assetName), true);
  }
});

test("packages the native Linux binary consistently in CI and releases", () => {
  for (const workflowPath of [
    ".github/workflows/ci.yml",
    ".github/workflows/release.yml",
  ]) {
    const workflow = readFileSync(join(root, workflowPath), "utf8");

    assert.match(workflow, /install -m 0755 src-tauri\/target\/release\/Logtext "\$thin_dir\/Logtext"/);
    assert.match(workflow, /packaging\/linux-thin\/README\.txt/);
    assert.match(workflow, /-C "\$thin_dir" Logtext README\.txt LICENSE/);
  }
});
