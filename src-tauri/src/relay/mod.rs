pub mod db;
pub mod event;
pub mod filter;
pub mod server;
pub mod sub;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

pub struct RelayHandle {
    shutdown_tx: tokio::sync::watch::Sender<bool>,
    thread: Option<std::thread::JoinHandle<()>>,
    port: Arc<Mutex<Option<u16>>>,
    data_dir: PathBuf,
}

impl RelayHandle {
    pub fn port(&self) -> Option<u16> {
        *self.port.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn data_dir(&self) -> &PathBuf {
        &self.data_dir
    }
}

impl Drop for RelayHandle {
    fn drop(&mut self) {
        println!("[relay] Sending shutdown signal");
        let _ = self.shutdown_tx.send(true);
        if let Some(handle) = self.thread.take() {
            let _ = handle.join();
        }
        println!("[relay] Shutdown complete");
    }
}

pub fn start_relay(data_dir: PathBuf, port: u16) -> Result<RelayHandle, Box<dyn std::error::Error>> {
    let (shutdown_tx, shutdown_rx) = tokio::sync::watch::channel(false);
    let bound_port: Arc<Mutex<Option<u16>>> = Arc::new(Mutex::new(None));
    let bound_port_clone = bound_port.clone();
    let data_dir_clone = data_dir.clone();

    let thread = std::thread::Builder::new()
        .name("vega-relay".into())
        .spawn(move || {
            let rt = tokio::runtime::Builder::new_multi_thread()
                .worker_threads(2)
                .enable_all()
                .build()
                .expect("Failed to create relay tokio runtime");
            rt.block_on(server::run(data_dir_clone, port, shutdown_rx, bound_port_clone));
        })?;

    Ok(RelayHandle {
        shutdown_tx,
        thread: Some(thread),
        port: bound_port,
        data_dir,
    })
}
