// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // WebKitGTK rendering workaround for Wayland/GPU issues.
    // DMABUF: blank windows on some compositors (Hyprland) due to EGL errors.
    #[cfg(target_os = "linux")]
    {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        // Force CPU-only rasterization while keeping the Wayland compositor path intact.
        // WEBKIT_DISABLE_COMPOSITING_MODE=1 kills the GPU process but also breaks Wayland
        // rendering (blank window on Hyprland). WEBKIT_FORCE_SOFTWARE_RENDERING=1 cuts GPU
        // RAM without disrupting the Wayland surface — the right tradeoff on this machine.
        std::env::set_var("WEBKIT_FORCE_SOFTWARE_RENDERING", "1");
    }

    vega_lib::run()
}
