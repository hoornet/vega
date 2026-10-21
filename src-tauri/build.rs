fn main() {
    // `install_info` reads VEGA_PACKAGED_BY with option_env!, which is baked in at
    // compile time; without this line cargo would keep the old value through a
    // rebuild in the same target directory.
    println!("cargo:rerun-if-env-changed=VEGA_PACKAGED_BY");
    tauri_build::build()
}
