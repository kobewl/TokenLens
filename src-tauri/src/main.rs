#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().is_some_and(|arg| arg == "--mcp") {
        if let Err(error) = tokenlens_lib::run_mcp(&args[1..]) {
            eprintln!("{error}");
            std::process::exit(1);
        }
    } else {
        tokenlens_lib::run()
    }
}
