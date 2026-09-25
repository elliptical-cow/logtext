use std::env;
use std::path::PathBuf;
use std::process::ExitCode;

use logtext_lib::logseq_import::{import_logseq_graph, LogseqImportOptions};

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("Error: {message}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<(), String> {
    let mut dry_run = false;
    let mut positional = Vec::new();

    for argument in env::args().skip(1) {
        match argument.as_str() {
            "--dry-run" => dry_run = true,
            "-h" | "--help" => {
                print_help();
                return Ok(());
            }
            value if value.starts_with('-') => {
                return Err(format!("Unknown option '{value}'. Use --help for usage."));
            }
            _ => positional.push(argument),
        }
    }

    if positional.len() != 2 {
        print_help();
        return Err("Expected a Logseq graph path and a new Logtext workspace path.".to_string());
    }

    let report = import_logseq_graph(
        &PathBuf::from(&positional[0]),
        &PathBuf::from(&positional[1]),
        LogseqImportOptions { dry_run },
    )?;
    let output = serde_json::to_string_pretty(&report)
        .map_err(|error| format!("Failed to serialize import report: {error}"))?;
    println!("{output}");
    Ok(())
}

fn print_help() {
    println!(
        "Logseq Markdown graph importer for Logtext\n\n\
Usage:\n  logtext-import-logseq [--dry-run] <LOGSEQ_GRAPH> <NEW_LOGTEXT_WORKSPACE>\n\n\
The source graph is never modified. The destination must not exist.\n\
Use --dry-run to validate and print the conversion report without writing files."
    );
}
