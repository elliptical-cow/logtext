# Backlog

## Implemented

- [x] Add an initial safe Logseq Markdown graph importer with dry-run reporting,
  portable page and journal paths, wiki-link and asset rewriting, task-state
  preservation, collision detection, and fixture-based tests.
- [x] Package the importer binary in Windows x86_64, Linux x86_64, and universal
  macOS CI and release artifacts.

## Follow-up

- [ ] Add an in-app `Import Logseq Graph...` workflow backed by the shared Rust
  importer.
- [ ] Add explicit conversion strategies for block references, embeds,
  scheduled tasks, deadlines, and aliases.
