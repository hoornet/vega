// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // WebKitGTK rendering workaround for Wayland/GPU issues.
    // DMABUF: blank windows on some compositors (Hyprland) due to EGL errors.
    #[cfg(target_os = "linux")]
    {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    vega_lib::run()
}
