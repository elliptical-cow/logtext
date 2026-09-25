# Importing A Logseq Markdown Graph

Logtext includes an initial command-line importer for classic, file-based Logseq
Markdown graphs. It creates a new Logtext workspace and never modifies the
source graph.

The importer does not read current Logseq DB graphs directly. If a graph stores
its content in `db.sqlite`, export it from Logseq as Markdown first and import
the exported file graph.

## Install Or Build The Importer

Each GitHub release provides a standalone `logtext-import-logseq` executable for
Linux x86_64, Windows x86_64, and macOS as a universal Apple Silicon/Intel
binary. Download the file for the target platform, make it executable on Linux
or macOS, and run it from a terminal. Windows uses the `.exe` suffix.

To build the importer from source instead, use:

```bash
cargo build --manifest-path src-tauri/Cargo.toml --release --locked \
  --bin logtext-import-logseq
```

The executable is written below `src-tauri/target/release/`.

## Run A Dry Run

Build requirements are the stable Rust toolchain and the normal Tauri platform
prerequisites documented in the project README.

From the repository root when running from source:

```bash
cargo run --manifest-path src-tauri/Cargo.toml --bin logtext-import-logseq -- \
  --dry-run /path/to/logseq-graph /path/to/new-logtext-workspace
```

The destination must not exist, its parent directory must exist, and it must not
be inside the source graph. A dry run reads and validates the source, prints the
planned JSON report, and writes nothing.

With a downloaded binary, use the same importer arguments without the Cargo
prefix:

```bash
./logtext-import-logseq --dry-run /path/to/logseq-graph /path/to/new-logtext-workspace
```

Remove `--dry-run` to create the new workspace:

```bash
cargo run --manifest-path src-tauri/Cargo.toml --bin logtext-import-logseq -- \
  /path/to/logseq-graph /path/to/new-logtext-workspace
```

The completed workspace contains `.logseq-import-report.json`. Review that file
before deleting or archiving the original graph.

## Converted Content

The first importer version supports conventional Markdown graphs:

- `pages/*.md` pages are moved to the Logtext workspace root;
- `Page___Namespace.md` names are converted to `Page/Namespace.md` paths;
- percent-encoded page filename components are decoded;
- `journals/YYYY_MM_DD.md` and `journals/YYYY-MM-DD.md` become
  `journal/YYYY-MM-DD.md`;
- safe custom `:pages-directory` and `:journals-directory` values from
  `logseq/config.edn` are respected;
- known wiki-link targets are rewritten to their new Logtext paths;
- files below `assets/` are copied below `media/`;
- Markdown links beginning with `../assets/` are rewritten to `media/`;
- pages without an H1 receive one before Logtext opens them;
- detected classic Logseq task states are retained in the generated Logtext
  workspace configuration;
- wiki-link targets without a corresponding imported page are listed in the
  report;
- filenames invalid on Windows are converted to portable names;
- case-insensitive and sanitized path collisions stop the import before any
  workspace is created.

The importer builds the complete path map before rewriting links. It writes all
output into a temporary sibling directory and only renames that directory to
the requested destination after every page, asset, configuration file, and
report has been written successfully.

## Preserved But Not Interpreted

The following source remains in imported Markdown but does not gain equivalent
Logtext behavior:

- block references such as `((uuid))`;
- block and page embeds;
- Logseq queries and macros;
- page and block properties outside Logtext's supported list-attribute form;
- scheduled dates, deadlines, repeaters, and Logbooks;
- plugin-specific syntax.

The report counts block references, embeds, queries, and macros so their impact
can be reviewed after conversion.

## Not Imported

- Org-mode files are counted in the report but are not converted.
- Whiteboard EDN files are counted but are not copied.
- Logseq configuration, plugins, themes, and application state are not copied.
- Symlinks are skipped.
- DB graph data is not read from SQLite.

Keep the original Logseq graph and normal backups until the imported workspace
has been checked in Logtext. The conversion is intentionally one-way; it does
not provide round-trip synchronization with Logseq.
