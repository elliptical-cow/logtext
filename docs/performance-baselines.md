# Performance Baselines

This document records current performance measurements for Logtext's derived
workspace indexes and whole-workspace queries. Markdown files remain the source
of truth. The benchmark creates disposable workspaces below the operating
system's temporary directory.

## Measurement Method

The benchmark calls the same Rust functions used by the application for:

- full workspace reindexing
- workspace search
- Task Overview loading
- one-file incremental reindexing
- one-file saving and derived-data recovery

Each operation has one warm-up run followed by five measured runs. The tables
report the median, arithmetic average, and slowest measured duration. Dataset
generation and release compilation are outside the measurements.

## Environment

- Date: 2026-09-06
- Hardware: MacBook Air (MacBookAir7,2), Intel Core i5 1.8 GHz, 2 cores / 4 logical CPUs, 8 GB RAM
- Build profile: Cargo `release`
- Rust toolchain: rustc 1.97.1, Cargo 1.97.1
- Logtext version: 0.7.1

## Datasets

| Dataset | Files | Folders | Bytes | Links | Tasks | Body lines per file |
|---|---:|---:|---:|---:|---:|---:|
| Sparse | 100 | 10 | 43,308 | 300 | 100 | 8 |
| Realistic | 1,000 | 50 | 1,011,730 | 6,000 | 1,000 | 20 |
| Stress | 5,000 | 100 | 5,080,850 | 30,000 | 5,000 | 20 |
| Large page | 1 | 1 | 3,694,478 | 101 | 1 | 100,000 |

## Results

All durations are milliseconds.

| Dataset | Operation | Median | Average | Slowest |
|---|---|---:|---:|---:|
| Sparse | Full reindex | 18.06 | 17.32 | 20.72 |
| Sparse | Workspace search | 1.39 | 1.40 | 1.60 |
| Sparse | Task Overview | 6.28 | 6.14 | 6.38 |
| Sparse | One-file incremental reindex | 1.86 | 1.93 | 2.53 |
| Sparse | One-file save recovery | 1.45 | 1.54 | 1.74 |
| Realistic | Full reindex | 412.25 | 415.59 | 437.26 |
| Realistic | Workspace search | 29.41 | 29.67 | 31.04 |
| Realistic | Task Overview | 134.72 | 136.06 | 141.90 |
| Realistic | One-file incremental reindex | 15.54 | 15.69 | 16.33 |
| Realistic | One-file save recovery | 0.95 | 1.56 | 3.52 |
| Stress | Full reindex | 9,201.37 | 9,133.87 | 9,328.77 |
| Stress | Workspace search | 156.72 | 156.09 | 160.72 |
| Stress | Task Overview | 682.23 | 688.44 | 712.34 |
| Stress | One-file incremental reindex | 65.70 | 66.98 | 72.90 |
| Stress | One-file save recovery | 4.11 | 4.34 | 6.02 |
| Large page | Full reindex | 321.52 | 321.13 | 330.62 |
| Large page | Workspace search | 56.70 | 56.97 | 59.02 |
| Large page | Task Overview | 328.54 | 328.85 | 333.85 |
| Large page | One-file incremental reindex | 308.25 | 312.72 | 326.69 |
| Large page | One-file save recovery | 330.58 | 330.22 | 334.09 |

## Reproduction

Run these commands from `src-tauri/`:

```sh
cargo run --locked --release --example reindex_benchmark -- --files 100 --folders 10 --links-per-file 2 --body-lines 8 --warmup-runs 1 --runs 5
cargo run --locked --release --example reindex_benchmark -- --files 1000 --folders 50 --links-per-file 5 --body-lines 20 --warmup-runs 1 --runs 5
cargo run --locked --release --example reindex_benchmark -- --files 5000 --folders 100 --links-per-file 5 --body-lines 20 --warmup-runs 1 --runs 5
cargo run --locked --release --example reindex_benchmark -- --files 1 --folders 1 --links-per-file 100 --body-lines 100000 --warmup-runs 1 --runs 5
```
