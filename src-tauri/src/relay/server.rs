use crate::relay::db;
use crate::relay::event::{Event, MAX_EVENT_SIZE};
use crate::relay::filter::Filter;
use crate::relay::sub::SubscriptionMap;
use futures_util::{SinkExt, StreamExt};
use rusqlite::Connection;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{broadcast, watch};
use tokio_tungstenite::tungstenite::Message;

/// Shared relay state across all connections.
struct RelayState {
    db: Mutex<Connection>,
    broadcast_tx: broadcast::Sender<String>,
}

/// Run the relay server. Blocks until shutdown signal.
pub async fn run(
    data_dir: PathBuf,
    port: u16,
    mut shutdown_rx: watch::Receiver<bool>,
    bound_port: Arc<Mutex<Option<u16>>>,
) {
    let conn = match db::open_relay_db(&data_dir) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[relay] Failed to open relay DB: {}", e);
            return;
        }
    };

    let (broadcast_tx, _) = broadcast::channel::<String>(1024);
    let state = Arc::new(RelayState {
        db: Mutex::new(conn),
        broadcast_tx,
    });

    // Try the requested port, then fallback ports
    let listener = match bind_with_fallback(port).await {
        Some(l) => l,
        None => {
            eprintln!("[relay] Could not bind to any port in range {}-{}", port, port + 10);
            return;
        }
    };

    let local_addr = listener.local_addr().unwrap();
    if let Ok(mut p) = bound_port.lock() {
        *p = Some(local_addr.port());
    }
    println!("[relay] Listening on ws://{}", local_addr);

    loop {
        tokio::select! {
            result = listener.accept() => {
                match result {
                    Ok((stream, addr)) => {
                        let state = state.clone();
                        let shutdown_rx = shutdown_rx.clone();
                        tokio::spawn(handle_connection(stream, addr, state, shutdown_rx));
                    }
                    Err(e) => {
                        eprintln!("[relay] Accept error: {}", e);
                    }
                }
            }
            _ = shutdown_rx.changed() => {
                println!("[relay] Shutting down");
                break;
            }
        }
    }
}

async fn bind_with_fallback(port: u16) -> Option<TcpListener> {
    for p in port..=port.saturating_add(10) {
        match TcpListener::bind(("127.0.0.1", p)).await {
            Ok(l) => return Some(l),
            Err(e) => {
                if p == port {
                    eprintln!("[relay] Port {} in use ({}), trying fallbacks...", p, e);
                }
            }
        }
    }
    None
}

async fn handle_connection(
    stream: TcpStream,
    addr: SocketAddr,
    state: Arc<RelayState>,
    mut shutdown_rx: watch::Receiver<bool>,
) {
    let ws = match tokio_tungstenite::accept_async(stream).await {
        Ok(ws) => ws,
        Err(e) => {
            eprintln!("[relay] WebSocket handshake failed from {}: {}", addr, e);
            return;
        }
    };

    let (mut ws_tx, mut ws_rx) = ws.split();
    let mut subs = SubscriptionMap::new();
    let mut broadcast_rx = state.broadcast_tx.subscribe();

    loop {
        tokio::select! {
            // Incoming WebSocket messages from this client
            msg = ws_rx.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        let responses = handle_message(&text, &state, &mut subs);
                        for resp in responses {
                            if ws_tx.send(Message::Text(resp.into())).await.is_err() {
                                return;
                            }
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => return,
                    Some(Err(_)) => return,
                    _ => {} // ping/pong/binary — ignore
                }
            }
            // Broadcast events from other connections
            result = broadcast_rx.recv() => {
                match result {
                    Ok(raw) => {
                        // Parse the event to check against subscriptions
                        if let Ok(event) = serde_json::from_str::<Event>(&raw) {
                            let matching = subs.matching_sub_ids(&event);
                            for sub_id in matching {
                                let msg = serde_json::json!(["EVENT", sub_id, serde_json::from_str::<serde_json::Value>(&raw).unwrap_or_default()]);
                                if ws_tx.send(Message::Text(msg.to_string().into())).await.is_err() {
                                    return;
                                }
                            }
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        eprintln!("[relay] Client {} lagged, skipped {} events", addr, n);
                    }
                    Err(broadcast::error::RecvError::Closed) => return,
                }
            }
            // Shutdown signal
            _ = shutdown_rx.changed() => return,
        }
    }
}

/// Handle a single NIP-01 message. Returns response messages to send back.
fn handle_message(text: &str, state: &RelayState, subs: &mut SubscriptionMap) -> Vec<String> {
    let parsed: serde_json::Value = match serde_json::from_str(text) {
        Ok(v) => v,
        Err(_) => return vec![notice("error: invalid JSON")],
    };

    let arr = match parsed.as_array() {
        Some(a) if !a.is_empty() => a,
        _ => return vec![notice("error: expected JSON array")],
    };

    let msg_type = match arr[0].as_str() {
        Some(s) => s,
        None => return vec![notice("error: first element must be a string")],
    };

    match msg_type {
        "EVENT" => handle_event(arr, state),
        "REQ" => handle_req(arr, state, subs),
        "CLOSE" => handle_close(arr, subs),
        _ => vec![notice(&format!("error: unknown message type: {}", msg_type))],
    }
}

fn handle_event(arr: &[serde_json::Value], state: &RelayState) -> Vec<String> {
    if arr.len() < 2 {
        return vec![notice("error: EVENT requires an event object")];
    }

    let raw = arr[1].to_string();

    // Size check
    if raw.len() > MAX_EVENT_SIZE {
        let id = arr[1]["id"].as_str().unwrap_or("");
        return vec![ok_msg(id, false, "error: event too large")];
    }

    let event: Event = match serde_json::from_value(arr[1].clone()) {
        Ok(e) => e,
        Err(e) => return vec![ok_msg("", false, &format!("error: invalid event: {}", e))],
    };

    // Verify ID
    if !event.verify_id() {
        return vec![ok_msg(&event.id, false, "error: invalid event id")];
    }

    // Verify signature
    if !event.verify_sig() {
        return vec![ok_msg(&event.id, false, "error: invalid signature")];
    }

    // Store
    let conn = match state.db.lock() {
        Ok(c) => c,
        Err(_) => return vec![ok_msg(&event.id, false, "error: internal database error")],
    };

    match db::store_event(&conn, &event, &raw) {
        Ok(true) => {
            // Broadcast to other connections
            let _ = state.broadcast_tx.send(raw);
            vec![ok_msg(&event.id, true, "")]
        }
        Ok(false) => {
            // Already exists or rejected (older replaceable)
            vec![ok_msg(&event.id, true, "duplicate:")]
        }
        Err(e) => vec![ok_msg(&event.id, false, &format!("error: {}", e))],
    }
}

fn handle_req(arr: &[serde_json::Value], state: &RelayState, subs: &mut SubscriptionMap) -> Vec<String> {
    if arr.len() < 3 {
        return vec![notice("error: REQ requires subscription id and at least one filter")];
    }

    let sub_id = match arr[1].as_str() {
        Some(s) => s.to_string(),
        None => return vec![notice("error: subscription id must be a string")],
    };

    // Parse filters (elements 2..n)
    let mut filters: Vec<Filter> = Vec::new();
    for val in &arr[2..] {
        match serde_json::from_value(val.clone()) {
            Ok(f) => filters.push(f),
            Err(e) => return vec![notice(&format!("error: invalid filter: {}", e))],
        }
    }

    // Register/replace subscription (NIP-01: same sub_id replaces)
    subs.upsert(sub_id.clone(), filters.clone());

    // Query DB for stored events matching filters
    let conn = match state.db.lock() {
        Ok(c) => c,
        Err(_) => return vec![notice("error: internal database error")],
    };

    let mut responses: Vec<String> = Vec::new();

    match db::query_events(&conn, &filters) {
        Ok(raws) => {
            for raw in raws {
                let event_val: serde_json::Value =
                    serde_json::from_str(&raw).unwrap_or_default();
                let msg = serde_json::json!(["EVENT", &sub_id, event_val]);
                responses.push(msg.to_string());
            }
        }
        Err(e) => {
            responses.push(notice(&format!("error: query failed: {}", e)));
        }
    }

    // EOSE
    responses.push(serde_json::json!(["EOSE", &sub_id]).to_string());

    responses
}

fn handle_close(arr: &[serde_json::Value], subs: &mut SubscriptionMap) -> Vec<String> {
    if arr.len() < 2 {
        return vec![notice("error: CLOSE requires a subscription id")];
    }

    let sub_id = match arr[1].as_str() {
        Some(s) => s,
        None => return vec![notice("error: subscription id must be a string")],
    };

    subs.remove(sub_id);
    vec![serde_json::json!(["CLOSED", sub_id, ""]).to_string()]
}

fn notice(msg: &str) -> String {
    serde_json::json!(["NOTICE", msg]).to_string()
}

fn ok_msg(id: &str, success: bool, message: &str) -> String {
    serde_json::json!(["OK", id, success, message]).to_string()
}
