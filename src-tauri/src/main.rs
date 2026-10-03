#![cfg_attr(all(not(debug_assertions), windows), windows_subsystem = "windows")]

//! Desktop executable entry point. Application setup lives in `logtext_lib` so
//! it remains available to tests and auxiliary binaries.

fn main() {
    logtext_lib::run();
}
