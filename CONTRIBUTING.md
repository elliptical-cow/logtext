# Contributing

Logtext is a local Markdown-first knowledge and task workspace built with
Tauri, Rust, Svelte, TypeScript, and CodeMirror. Markdown files are the source
of truth. Changes that parse, move, rename, delete, or rewrite user files must
therefore be conservative and covered by focused tests.

## Development Setup

Requirements:

- Node.js 22 and npm
- the stable Rust toolchain with `rustfmt`
- the [Tauri 2 platform prerequisites](https://v2.tauri.app/start/prerequisites/)

Install the locked frontend dependencies:

```bash
npm ci
```

Run the desktop application:

```bash
npm run tauri dev
```

For frontend-only work, run the Vite development server:

```bash
npm run dev
```

## Repository Map

- `src/`: Svelte UI, stores, editor integration, and frontend domain helpers
- `src-tauri/src/`: filesystem operations, indexing, parsing, configuration,
  and native application integration
- `tests/`: frontend and cross-layer contract tests
- `docs/manual.md`: user-facing behavior and reference documentation
- `docs/dev-notes.md`: architecture and implementation decisions
- `.github/workflows/`: CI and release automation

Prefer an existing helper, store, or operation layer over introducing a second
implementation of the same Markdown, link, task, or mutation behavior.

## Working on a Change

1. Start from the current `main` branch.
2. Create a short-lived branch such as `feature/config-system`,
   `fix/startup-crash`, `refactor/link-index`, `docs/release-process`, or
   `chore/github-workflow`.
3. Inspect the relevant production and test paths before editing.
4. Keep the change focused. Update tests and user documentation in the same
   branch when behavior changes.
5. Run the checks appropriate to the risk, then open a pull request against
   `main`.

Treat `main` as stable and release-ready. Do not develop directly on it. Keep
commits understandable; intermediate and `fixup!` commits are acceptable on a
working branch, but unrelated work belongs on another branch.

## Safety and Architecture

- Keep Markdown files canonical. Databases and caches may support indexing,
  search, link resolution, or performance, but not replace workspace files.
- Preserve user-created and untracked files.
- Make destructive actions explicit and conservative.
- Moving or renaming files and folders must update affected wiki links and
  related configuration state.
- Reuse the shared parsing and mutation paths instead of duplicating Markdown,
  link, task, or checkbox logic across frontend and backend.
- Do not commit generated output or local workspace data such as
  `node_modules`, `dist`, `target`, `.DS_Store`, or example-workspace archives.

File-operation changes should test move, rename, and delete behavior; wiki-link
rewriting; configuration cleanup or remapping; and dirty or conflicting editor
states. Parser and task changes should add shared or targeted fixtures for the
affected source forms.

## Checks

Before opening a pull request, run the complete local quality suite:

```bash
npm run check
npm run test:frontend
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml --locked
git diff --check
```

During development, use the smallest relevant test first. Run broader tests
when changing core behavior, file operations, link rewriting, configuration
parsing, indexing, shared Markdown contracts, or release metadata.

## Documentation

- Keep `README.md` concise: product idea, main features, installation, and a
  short path to first use.
- Document user-facing workflows, syntax, shortcuts, and limitations in
  `docs/manual.md`.
- Put exact source-format details in the manual's reference section when they
  matter to users, backups, or version-control review.
- Record architecture and internal design decisions in `docs/dev-notes.md`.
- Update `packaging/linux-thin/README.txt` when the thin archive's runtime
  requirements, contents, or limitations change.

Documentation should describe the behavior shipped by the same change. Avoid
copying generated shortcut lists or implementation details into multiple files
unless the duplication materially helps users.

## Commits and Pull Requests

Use a conventional commit-style summary:

```text
<type>(<scope>): <short summary>
```

Useful types include `feat`, `fix`, `docs`, `refactor`, `test`, `chore`,
`build`, `ci`, and `perf`. Use the same format for the pull-request title and
the final squash commit.

When AI assistance was used for a change, include a short explanatory body and
end the commit message with this exact sentence:

```text
The code in this commit was written with ai-assistance.
```

Pull requests should explain the user-visible outcome, note any user-data risk,
and list the checks performed. Ensure required CI checks pass before squash
merging into `main`, then delete the short-lived branch.

## Continuous Integration

Pushes to `main` and the supported `feature/**`, `fix/**`, `refactor/**`,
`chore/**`, and `docs/**` branches run checks, tests, and cross-platform Tauri
builds. These builds upload temporary artifacts for Windows, macOS, and Linux.

Pull requests targeting `main` rerun checks and tests against the proposed
merge without repeating the platform build matrix. Push and pull-request runs
use separate concurrency groups. CI never creates a GitHub Release.

## Releases

A merge to `main` is not a release. Before tagging a release:

1. Update the version in `package.json`, `package-lock.json`,
   `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, and
   `src-tauri/tauri.conf.json`.
2. Update `CHANGELOG.md` and any version-specific user documentation.
3. Merge the tested change into `main` and verify that main CI passes.
4. Create a semantic version tag such as `v1.2.3` on that tested main commit.

The tag must match the source version. Pushing it starts
`.github/workflows/release.yml`, which verifies the tag and main ancestry,
reruns the complete test suite, builds all release packages, and publishes the
GitHub Release only after every platform build succeeds.

Published assets use `Logtext-v<version>-<os>-<architecture>` names. Windows
assets identify the portable executable or installer, and the macOS archive is
a universal application bundle.
