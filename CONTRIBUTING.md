# Contributing

Logtext is a local Markdown-first knowledge workspace built with Tauri, Rust,
Svelte, TypeScript, and CodeMirror. Markdown files are the source of truth, so
changes that move, rename, delete, parse, or rewrite files must be conservative
and covered by focused tests.

## Development Setup

Requirements:

- Node.js 22 and npm (the versions used by CI)
- The stable Rust toolchain with `rustfmt`
- The platform prerequisites for Tauri 2

Install the locked frontend dependencies:

```bash
npm ci
```

Run the Tauri desktop application:

```bash
npm run tauri dev
```

For frontend-only work, run the Vite development server instead:

```bash
npm run dev
```

## Development Guidelines

- Keep changes small and scoped, and prefer existing helpers and stores over
  new abstractions.
- Treat Markdown files as canonical. Databases and caches may only support
  indexing, search, link resolution, or performance.
- Preserve user-created and untracked files. Destructive file operations must
  be explicit and conservative.
- Moving or renaming files and folders must update affected wiki links and
  related configuration state.
- Do not commit generated output or local workspace data such as
  `node_modules`, `dist`, `target`, `.DS_Store`, or example-workspace archives.

File-operation changes should include tests for move, rename, and delete
behavior; wiki-link rewriting; configuration cleanup or remapping; and
dirty/conflict editor safeguards.

## Checks

Before opening a pull request, run the same quality checks as CI:

```bash
npm run check
npm run test:frontend
npm run build
git diff --check

cd src-tauri
cargo fmt --check
cargo test --locked
```

Run additional targeted tests when changing core behavior, file operations,
link rewriting, configuration parsing, or indexing.

## Branches and Pull Requests

- Treat `main` as stable and release-ready. Do not develop directly on it.
- Create a short-lived branch from the current `main`, for example
  `feature/config-system`, `fix/startup-crash`, `refactor/link-index`,
  `docs/release-process`, or `chore/github-workflow`.
- Keep commits understandable and avoid mixing unrelated work. Intermediate
  commits and `fixup!` commits are acceptable on a working branch.
- Do not include unrelated generated files or local workspace content.
- Describe user-data risks and the checks performed in the pull request.
- Ensure required CI checks pass, then use a meaningful conventional title and
  body for the GitHub squash merge into `main`.
- Delete the short-lived branch after the squash merge.

Pushes to supported working branches and `main` run checks, tests, and
cross-platform builds, producing temporary GitHub Actions artifacts. Pull
requests targeting `main` rerun checks and tests against the proposed merge
without repeating the Tauri build matrix. Neither event creates a GitHub
Release.

## Commit Messages

Use a conventional commit-style summary:

```text
<type>(<scope>): <short summary>
```

Useful types include `feat`, `fix`, `docs`, `refactor`, `test`, `chore`,
`build`, `ci`, and `perf`. Use the same format for the pull-request title and
final squash commit.

Disclose AI assistance when it was used to write code. AI-assisted commits in
this repository use a short explanatory body ending with this exact sentence:

```text
The code in this commit was written with ai-assistance.
```

## Releases

A merge to `main` is not a release. Official releases are created only from a
tested commit on `main` by pushing a semantic version tag such as `v1.2.3`. The
tag must match the versions in `package.json`, `src-tauri/Cargo.toml`, and
`src-tauri/tauri.conf.json`.

Pushing the tag starts `.github/workflows/release.yml`. It reruns the complete
verification suite, builds Windows, macOS, and Linux packages, and creates the
GitHub Release only after all platform builds succeed.
