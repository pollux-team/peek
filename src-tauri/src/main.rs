// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // call the library entry point. the library is named `peek_lib` in
    // Cargo.toml ([lib] name = "peek_lib").
    peek_lib::run();
}
