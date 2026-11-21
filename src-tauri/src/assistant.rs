//! The assistant's requests to a language model (see "The assistant" in CLAUDE.md).
//!
//! The webview builds what to ask; this module sends it, streams the answer back as
//! `assistant-chunk` events, and holds the API keys. Three rules make that worth doing here
//! rather than in the webview:
//!
//! - **A key never reaches the webview.** Keys live in the OS keychain under a service of their
//!   own (`KEY_SERVICE`), not under `wrystr`, because `load_nsec` hands the webview whatever
//!   `wrystr` entry it names. Nothing here returns a key.
//! - **A key goes only to the address it was saved for.** The keychain holds the key with its
//!   base URL, and a request for another address gets no key. Otherwise a script that got into
//!   the webview could name its own server and have the key sent there.
//! - **A local model is reached without widening the webview's reach.** plugin-http allows
//!   `https://**` only; Ollama listens on `http://localhost`. Rust reaches the one configured
//!   address, through the user's proxy unless the address is on this computer.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Url};

/// The keychain service for assistant keys. Not `wrystr`: see the module comment.
const KEY_SERVICE: &str = "vega-assistant";

/// How long the waits of a request are, and how much of an answer is kept.
#[derive(Clone, Copy)]
struct Limits {
    /// Until the server's response begins. Long: a local model on a slow machine is loaded first.
    headers: Duration,
    /// Between two pieces of an answer.
    idle: Duration,
    /// The longest answer kept: past this the stream is cut and what arrived is returned.
    max_answer: usize,
    /// The longest a line may grow while its end has not arrived.
    max_line: usize,
}

const LIMITS: Limits = Limits {
    headers: Duration::from_secs(180),
    idle: Duration::from_secs(60),
    max_answer: 64 * 1024,
    max_line: 256 * 1024,
};
/// The most a request may carry, in characters of message text.
const MAX_REQUEST: usize = 200_000;
/// The most a model list may hold, and the longest name kept.
const MAX_MODELS: usize = 200;
const MAX_MODEL_NAME: usize = 200;

/// Which wire format the provider speaks.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
pub enum ProviderKind {
    /// Anthropic's Messages API.
    #[serde(rename = "anthropic")]
    Anthropic,
    /// OpenAI-compatible chat completions: Ollama's `/v1`, LM Studio, OpenAI, xAI, OpenRouter.
    #[serde(rename = "openai")]
    OpenAi,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct ChatMessage {
    /// "user" or "assistant". The system prompt travels separately.
    pub role: String,
    pub content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AskRequest {
    /// Chosen by the webview; names the stream's events and lets it be cancelled.
    pub id: String,
    /// Which saved key may be used ("claude", "custom", ...).
    pub slot: String,
    pub kind: ProviderKind,
    pub base_url: String,
    pub model: String,
    pub max_tokens: u32,
    pub system: String,
    pub messages: Vec<ChatMessage>,
}

/// What the keychain holds for a slot: the key and the only address it may be sent to.
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SavedKey {
    base_url: String,
    key: String,
}

/// How a request is told to stop: a flag for the checks between reads, and a wake-up for a read
/// that is waiting, so Stop does not wait for the server to send something.
#[derive(Default)]
pub struct Cancel {
    flag: AtomicBool,
    wake: tokio::sync::Notify,
}

impl Cancel {
    pub fn cancel(&self) {
        self.flag.store(true, Ordering::Relaxed);
        // Keeps a permit when nothing waits yet, so a stop that lands between two reads is not lost.
        self.wake.notify_one();
    }

    fn is_cancelled(&self) -> bool {
        self.flag.load(Ordering::Relaxed)
    }
}

/// Requests still streaming, by id, with what stops them.
#[derive(Default)]
pub struct Requests(Mutex<HashMap<String, Arc<Cancel>>>);

#[derive(Clone, Serialize)]
struct Chunk<'a> {
    id: &'a str,
    text: &'a str,
}

// ── Addresses and keys ──────────────────────────────────────────────────────

/// A base URL as it is saved and compared: http or https, no user name, password, query or
/// fragment, no trailing slash.
pub fn normalize_base(raw: &str) -> Result<String, String> {
    let url: Url = raw
        .trim()
        .parse()
        .map_err(|_| "That is not a web address.".to_string())?;
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err("The address must start with http:// or https://.".into());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("Leave the user name and password out of the address.".into());
    }
    if url.query().is_some() || url.fragment().is_some() || url.host_str().is_none() {
        return Err("That is not an address a model server answers on.".into());
    }
    Ok(url.as_str().trim_end_matches('/').to_string())
}

/// Whether a key may be sent to `base`: over https, or over http to this computer only. Anyone on
/// the way could read a key sent over plain http elsewhere.
fn key_may_travel(base: &str) -> Result<(), String> {
    let url: Url = base.parse().map_err(|_| "That is not a web address.".to_string())?;
    if url.scheme() == "https" || is_loopback(&url) {
        Ok(())
    } else {
        Err("A key is only sent over https, or to a server on this computer.".into())
    }
}

/// The key a request may carry: the saved one when it was saved for this very address (and may
/// travel there), none when nothing is saved, and a refusal when it was saved for another address.
fn key_for(saved: Option<SavedKey>, base: &str) -> Result<Option<String>, String> {
    match saved {
        None => Ok(None),
        Some(saved) if saved.base_url == base => key_may_travel(base).map(|()| Some(saved.key)),
        Some(saved) => Err(format!(
            "The key in your keychain was saved for {}, not {}. Save it again for this address.",
            saved.base_url, base
        )),
    }
}

fn valid_slot(slot: &str) -> Result<(), String> {
    let ok = !slot.is_empty()
        && slot.len() <= 32
        && slot
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
    if ok {
        Ok(())
    } else {
        Err("Unknown provider.".into())
    }
}

fn entry(slot: &str) -> Result<keyring::Entry, String> {
    valid_slot(slot)?;
    keyring::Entry::new(KEY_SERVICE, slot).map_err(|e| e.to_string())
}

fn load_saved(slot: &str) -> Result<Option<SavedKey>, String> {
    match entry(slot)?.get_password() {
        Ok(raw) => Ok(serde_json::from_str(&raw).ok()),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Saves a key for `slot`, to be sent to `base_url` and nowhere else.
#[tauri::command]
pub fn assistant_save_key(slot: String, base_url: String, key: String) -> Result<(), String> {
    let base = normalize_base(&base_url)?;
    key_may_travel(&base)?;
    let key = key.trim();
    if key.is_empty() || key.len() > 512 || key.chars().any(char::is_whitespace) {
        return Err("That does not look like an API key.".into());
    }
    let value = serde_json::to_string(&SavedKey {
        base_url: base,
        key: key.to_string(),
    })
    .map_err(|e| e.to_string())?;
    entry(&slot)?.set_password(&value).map_err(|e| e.to_string())
}

/// The address a key is saved for, or None: never the key itself.
#[tauri::command]
pub fn assistant_key_status(slot: String) -> Result<Option<String>, String> {
    Ok(load_saved(&slot)?.map(|saved| saved.base_url))
}

#[tauri::command]
pub fn assistant_forget_key(slot: String) -> Result<(), String> {
    match entry(&slot)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

// ── The wire ────────────────────────────────────────────────────────────────

fn endpoint(kind: ProviderKind, base: &str, models: bool) -> String {
    match (kind, models) {
        (ProviderKind::Anthropic, false) => format!("{base}/v1/messages"),
        (ProviderKind::Anthropic, true) => format!("{base}/v1/models"),
        (ProviderKind::OpenAi, false) => format!("{base}/chat/completions"),
        (ProviderKind::OpenAi, true) => format!("{base}/models"),
    }
}

/// Whether an address is on this computer: such a request never goes through the proxy.
fn is_loopback(url: &Url) -> bool {
    let Some(host) = url.host_str() else {
        return false;
    };
    let host = host.trim_start_matches('[').trim_end_matches(']');
    host.eq_ignore_ascii_case("localhost")
        || host.parse::<std::net::IpAddr>().map(|ip| ip.is_loopback()).unwrap_or(false)
}

/// Installs ring as rustls's crypto provider, unless one is installed already. reqwest is built
/// with `rustls-no-provider` here (through the updater), and building a client without a provider
/// panics; the updater installs this same provider, but only when it checks for an update.
fn ensure_tls_provider() {
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        // Fails only when another thread installed one in between, which is just as good.
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
}

/// What every assistant client starts from. **Redirects are not followed**: reqwest drops
/// `Authorization` on a redirect to another host but not `x-api-key`, so a server (or anyone
/// answering in its place) could send Claude's key on to a host of its choosing; and no model API
/// needs one. A redirect is reported as such (`status_problem`).
fn client_builder() -> reqwest::ClientBuilder {
    ensure_tls_provider();
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
}

/// The user's proxy for the assistant's requests, with `socks5://` read as `socks5h://`: the proxy
/// looks the name up, so the model server's name never goes to the local resolver. A user who set
/// a proxy wants the request hidden, and plain `socks5` leaks which server was asked.
fn assistant_proxy(url: &str) -> String {
    match url.strip_prefix("socks5://") {
        Some(rest) => format!("socks5h://{rest}"),
        None => url.to_string(),
    }
}

fn client(app: &AppHandle, base: &str) -> Result<reqwest::Client, String> {
    let url: Url = base.parse().map_err(|_| "That is not a web address.".to_string())?;
    let mut builder = client_builder();
    if is_loopback(&url) {
        builder = builder.no_proxy();
    } else if let Some(proxy) = crate::enabled_proxy_url(&crate::load_proxy_settings_from_disk(app))? {
        let proxy = assistant_proxy(proxy.as_str());
        builder = builder.proxy(reqwest::Proxy::all(&proxy).map_err(|e| e.to_string())?);
    }
    builder.build().map_err(|e| e.to_string())
}

fn with_key(
    request: reqwest::RequestBuilder,
    kind: ProviderKind,
    key: Option<&str>,
) -> reqwest::RequestBuilder {
    match (kind, key) {
        (ProviderKind::Anthropic, Some(key)) => request
            .header("x-api-key", key)
            .header("anthropic-version", "2023-06-01"),
        (ProviderKind::Anthropic, None) => request.header("anthropic-version", "2023-06-01"),
        (ProviderKind::OpenAi, Some(key)) => request.bearer_auth(key),
        (ProviderKind::OpenAi, None) => request,
    }
}

fn request_body(request: &AskRequest) -> serde_json::Value {
    let max_tokens = request.max_tokens.clamp(1, 4096);
    match request.kind {
        ProviderKind::Anthropic => serde_json::json!({
            "model": request.model,
            "max_tokens": max_tokens,
            "stream": true,
            "system": request.system,
            "messages": request.messages,
        }),
        ProviderKind::OpenAi => {
            let mut messages = vec![serde_json::json!({ "role": "system", "content": request.system })];
            messages.extend(request.messages.iter().map(|m| serde_json::json!(m)));
            serde_json::json!({
                "model": request.model,
                "max_tokens": max_tokens,
                "stream": true,
                "messages": messages,
            })
        }
    }
}

/// What one line of a server-sent event stream says.
#[derive(Debug, PartialEq, Eq)]
pub enum StreamLine {
    Text(String),
    Done,
    Error(String),
    Nothing,
}

/// Reads one line of the stream. Only `data:` lines carry anything; the rest (`event:`,
/// comments, blank lines) say nothing on their own.
pub fn read_stream_line(kind: ProviderKind, line: &str) -> StreamLine {
    let Some(data) = line.strip_prefix("data:") else {
        return StreamLine::Nothing;
    };
    let data = data.trim();
    if data == "[DONE]" {
        return StreamLine::Done;
    }
    let Ok(value) = serde_json::from_str::<serde_json::Value>(data) else {
        return StreamLine::Nothing;
    };
    if let Some(message) = value.pointer("/error/message").and_then(|m| m.as_str()) {
        return StreamLine::Error(clip(message, 200));
    }
    match kind {
        ProviderKind::OpenAi => match value.pointer("/choices/0/delta/content").and_then(|t| t.as_str()) {
            Some(text) if !text.is_empty() => StreamLine::Text(text.to_string()),
            _ => StreamLine::Nothing,
        },
        ProviderKind::Anthropic => match value.get("type").and_then(|t| t.as_str()) {
            Some("content_block_delta") => match value.pointer("/delta/text").and_then(|t| t.as_str()) {
                Some(text) if !text.is_empty() => StreamLine::Text(text.to_string()),
                _ => StreamLine::Nothing,
            },
            Some("message_stop") => StreamLine::Done,
            _ => StreamLine::Nothing,
        },
    }
}

fn clip(text: &str, max: usize) -> String {
    let mut out: String = text.chars().take(max).collect();
    if text.chars().count() > max {
        out.push('…');
    }
    out
}

/// A refusal from the server, in the user's words, with the server's own reason when it gave one.
pub fn status_problem(status: u16, body: &str) -> String {
    let said = serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|v| {
            v.pointer("/error/message")
                .or_else(|| v.get("error"))
                .or_else(|| v.get("message"))
                .and_then(|m| m.as_str().map(str::to_string))
        })
        .map(|m| clip(&m, 200));
    let what = match status {
        300..=399 => "The server sent Vega to another address, which it does not follow with your request. Check the address.".to_string(),
        401 | 403 => "The key was not accepted.".to_string(),
        404 => "The address or the model was not found.".to_string(),
        429 => "Too many requests: the provider asks you to wait.".to_string(),
        500..=599 => format!("The model server had a problem ({status})."),
        _ => format!("The model server said no ({status})."),
    };
    match said {
        Some(said) if !said.is_empty() => format!("{what} It said: {said}"),
        _ => what,
    }
}

fn send_problem(err: &reqwest::Error) -> String {
    if err.is_connect() {
        "The model server could not be reached. Is it running, and is the address right?".into()
    } else if err.is_timeout() {
        "The model server did not answer in time.".into()
    } else {
        format!("The request failed: {}", clip(&err.to_string(), 200))
    }
}

/// Reads at most `max` bytes of a body, for an error message.
async fn read_capped(response: &mut reqwest::Response, max: usize) -> String {
    let mut body = Vec::new();
    while body.len() < max {
        match tokio::time::timeout(Duration::from_secs(5), response.chunk()).await {
            Ok(Ok(Some(bytes))) => body.extend_from_slice(&bytes),
            _ => break,
        }
    }
    body.truncate(max);
    String::from_utf8_lossy(&body).into_owned()
}

/// Removes a request from the registry when it ends, however it ends.
struct Registered<'a> {
    requests: &'a Requests,
    id: String,
}

impl Drop for Registered<'_> {
    fn drop(&mut self) {
        if let Ok(mut map) = self.requests.0.lock() {
            map.remove(&self.id);
        }
    }
}

/// Sends a request and streams the answer as `assistant-chunk` events; returns the whole answer
/// once the stream ends or is cancelled.
#[tauri::command]
pub async fn assistant_ask(
    app: AppHandle,
    requests: tauri::State<'_, Requests>,
    request: AskRequest,
) -> Result<String, String> {
    let base = normalize_base(&request.base_url)?;
    if request.model.trim().is_empty() {
        return Err("Choose a model first.".into());
    }
    if request.id.is_empty() || request.id.len() > 64 {
        return Err("Bad request id.".into());
    }
    if request.messages.iter().any(|m| m.role != "user" && m.role != "assistant") {
        return Err("Bad message role.".into());
    }
    let size: usize = request.system.len() + request.messages.iter().map(|m| m.content.len()).sum::<usize>();
    if size > MAX_REQUEST {
        return Err("The question and what goes with it are too long.".into());
    }
    let key = key_for(load_saved(&request.slot)?, &base)?;
    if request.kind == ProviderKind::Anthropic && key.is_none() {
        return Err("No API key is saved for this provider. Add one in Settings → Assistant.".into());
    }

    let cancelled = Arc::new(Cancel::default());
    requests
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .insert(request.id.clone(), cancelled.clone());
    let _registered = Registered { requests: requests.inner(), id: request.id.clone() };

    let http = client(&app, &base)?;
    stream_answer(&http, &request, &base, key.as_deref(), &cancelled, LIMITS, |text| {
        let _ = app.emit("assistant-chunk", Chunk { id: &request.id, text });
    })
    .await
}

/// Sends the request and reads the answer as it streams, handing each piece to `on_text`. Stops at
/// the stream's end, at a cancel (returning what arrived, at once, even mid-read), or at
/// `limits.max_answer`.
async fn stream_answer(
    http: &reqwest::Client,
    request: &AskRequest,
    base: &str,
    key: Option<&str>,
    cancel: &Cancel,
    limits: Limits,
    mut on_text: impl FnMut(&str),
) -> Result<String, String> {
    let call = with_key(
        http.post(endpoint(request.kind, base, false))
            .header("content-type", "application/json")
            .body(request_body(request).to_string()),
        request.kind,
        key,
    );
    let sent = tokio::select! {
        biased;
        _ = cancel.wake.notified() => return Ok(String::new()),
        sent = tokio::time::timeout(limits.headers, call.send()) => sent,
    };
    let mut response = sent
        .map_err(|_| "The model server did not answer in time.".to_string())?
        .map_err(|e| send_problem(&e))?;
    if !response.status().is_success() {
        let body = read_capped(&mut response, 4096).await;
        return Err(status_problem(response.status().as_u16(), &body));
    }

    let mut pending: Vec<u8> = Vec::new();
    let mut answer = String::new();
    // A page that is not a stream (an HTML page from a wrong address, answered with 200) has no
    // `data:` line at all: that is not an empty answer, it is no answer.
    let mut saw_data = false;
    'stream: loop {
        if cancel.is_cancelled() || answer.len() >= limits.max_answer {
            break;
        }
        let next = tokio::select! {
            biased;
            _ = cancel.wake.notified() => break 'stream,
            next = tokio::time::timeout(limits.idle, response.chunk()) => next,
        };
        let next = next
            .map_err(|_| "The model stopped answering.".to_string())?
            .map_err(|e| send_problem(&e))?;
        let Some(bytes) = next else { break };
        pending.extend_from_slice(&bytes);
        // Whole lines only: a chunk can end in the middle of a character.
        while let Some(end) = pending.iter().position(|b| *b == b'\n') {
            let line: Vec<u8> = pending.drain(..=end).collect();
            let line = String::from_utf8_lossy(&line);
            let line = line.trim_end();
            saw_data |= line.starts_with("data:");
            match read_stream_line(request.kind, line) {
                StreamLine::Text(text) => {
                    let room = limits.max_answer.saturating_sub(answer.len());
                    let piece = clip_bytes(&text, room);
                    if !piece.is_empty() {
                        answer.push_str(piece);
                        on_text(piece);
                    }
                    if answer.len() >= limits.max_answer {
                        break 'stream;
                    }
                }
                StreamLine::Done => break 'stream,
                StreamLine::Error(message) => return Err(format!("The model stopped with an error: {message}")),
                StreamLine::Nothing => {}
            }
        }
        if pending.len() > limits.max_line {
            return Err("The model server sent something that is not an answer.".into());
        }
    }
    if !saw_data && !cancel.is_cancelled() {
        return Err("The server answered, but not with a model's reply. Check the address and the model.".into());
    }
    Ok(answer)
}

/// The longest start of `text` that fits in `max` bytes without cutting a character.
fn clip_bytes(text: &str, max: usize) -> &str {
    if text.len() <= max {
        return text;
    }
    let mut end = max;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    &text[..end]
}

/// Stops a request that is still streaming. What arrived so far is kept by the caller.
#[tauri::command]
pub fn assistant_cancel(requests: tauri::State<'_, Requests>, id: String) -> Result<(), String> {
    if let Some(cancel) = requests.0.lock().map_err(|e| e.to_string())?.get(&id) {
        cancel.cancel();
    }
    Ok(())
}

/// The models a server offers, by name, for the Settings picker.
#[tauri::command]
pub async fn assistant_models(
    app: AppHandle,
    slot: String,
    kind: ProviderKind,
    base_url: String,
) -> Result<Vec<String>, String> {
    let base = normalize_base(&base_url)?;
    let key = key_for(load_saved(&slot)?, &base)?;
    let http = client(&app, &base)?;
    let mut response = with_key(http.get(endpoint(kind, &base, true)), kind, key.as_deref())
        .timeout(Duration::from_secs(20))
        .send()
        .await
        .map_err(|e| send_problem(&e))?;
    let body = read_capped(&mut response, 512 * 1024).await;
    if !response.status().is_success() {
        return Err(status_problem(response.status().as_u16(), &body));
    }
    Ok(model_names(&body))
}

/// Model names from a `{ "data": [{ "id": ... }] }` list, which both wire formats return.
pub fn model_names(body: &str) -> Vec<String> {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(body) else {
        return Vec::new();
    };
    let mut names: Vec<String> = value
        .get("data")
        .and_then(|d| d.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("id").and_then(|id| id.as_str()))
                .filter(|id| !id.is_empty() && id.len() <= MAX_MODEL_NAME)
                .map(str::to_string)
                .take(MAX_MODELS)
                .collect()
        })
        .unwrap_or_default();
    names.sort();
    names.dedup();
    names
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_base_url_is_kept_plain() {
        assert_eq!(normalize_base("http://localhost:11434/v1/").unwrap(), "http://localhost:11434/v1");
        assert_eq!(normalize_base(" https://api.anthropic.com ").unwrap(), "https://api.anthropic.com");
        for bad in ["ftp://x.example", "https://u:p@x.example", "https://x.example/v1?a=b", "not a url", "file:///etc"] {
            assert!(normalize_base(bad).is_err(), "{bad}");
        }
    }

    fn saved(base: &str) -> Option<SavedKey> {
        Some(SavedKey { base_url: base.into(), key: "sk-test".into() })
    }

    #[test]
    fn a_key_goes_only_to_the_address_it_was_saved_for() {
        assert_eq!(key_for(saved("https://api.anthropic.com"), "https://api.anthropic.com").unwrap(), Some("sk-test".into()));
        assert!(key_for(saved("https://api.anthropic.com"), "https://evil.example").is_err());
        assert!(key_for(saved("https://api.anthropic.com"), "https://api.anthropic.com.evil.example").is_err());
        assert_eq!(key_for(None, "http://localhost:11434/v1").unwrap(), None);
    }

    #[test]
    fn only_plain_slot_names() {
        assert!(valid_slot("claude").is_ok());
        assert!(valid_slot("custom-2").is_ok());
        let long = "x".repeat(33);
        for bad in ["", "Claude", "../x", "a b", long.as_str()] {
            assert!(valid_slot(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn the_local_machine_is_recognised() {
        for local in ["http://localhost:11434/v1", "http://127.0.0.1:1234", "http://[::1]:8080"] {
            assert!(is_loopback(&local.parse().unwrap()), "{local}");
        }
        for remote in ["https://api.anthropic.com", "http://192.168.1.5:11434", "http://localhost.example"] {
            assert!(!is_loopback(&remote.parse().unwrap()), "{remote}");
        }
    }

    #[test]
    fn reads_an_openai_compatible_stream() {
        let k = ProviderKind::OpenAi;
        assert_eq!(read_stream_line(k, r#"data: {"choices":[{"delta":{"content":"Hel"}}]}"#), StreamLine::Text("Hel".into()));
        assert_eq!(read_stream_line(k, r#"data: {"choices":[{"delta":{"role":"assistant"}}]}"#), StreamLine::Nothing);
        assert_eq!(read_stream_line(k, "data: [DONE]"), StreamLine::Done);
        assert_eq!(read_stream_line(k, r#"data: {"error":{"message":"model not found"}}"#), StreamLine::Error("model not found".into()));
        assert_eq!(read_stream_line(k, ": keep-alive"), StreamLine::Nothing);
        assert_eq!(read_stream_line(k, ""), StreamLine::Nothing);
        assert_eq!(read_stream_line(k, "data: {not json"), StreamLine::Nothing);
    }

    #[test]
    fn reads_an_anthropic_stream() {
        let k = ProviderKind::Anthropic;
        assert_eq!(read_stream_line(k, "event: content_block_delta"), StreamLine::Nothing);
        assert_eq!(
            read_stream_line(k, r#"data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}"#),
            StreamLine::Text("Hi".into())
        );
        assert_eq!(read_stream_line(k, r#"data: {"type":"message_start","message":{}}"#), StreamLine::Nothing);
        assert_eq!(read_stream_line(k, r#"data: {"type":"message_stop"}"#), StreamLine::Done);
        assert_eq!(
            read_stream_line(k, r#"data: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}"#),
            StreamLine::Error("Overloaded".into())
        );
    }

    #[test]
    fn a_refusal_is_said_in_words_with_the_servers_reason() {
        assert_eq!(status_problem(401, r#"{"error":{"message":"invalid x-api-key"}}"#), "The key was not accepted. It said: invalid x-api-key");
        assert_eq!(status_problem(404, r#"{"error":"model 'x' not found"}"#), "The address or the model was not found. It said: model 'x' not found");
        assert_eq!(status_problem(429, ""), "Too many requests: the provider asks you to wait.");
        assert_eq!(status_problem(503, "<html>"), "The model server had a problem (503).");
    }

    #[test]
    fn lists_model_names_from_either_server() {
        let body = r#"{"object":"list","data":[{"id":"llama3.2:3b"},{"id":"qwen2.5:7b"},{"id":"llama3.2:3b"},{"id":""}]}"#;
        assert_eq!(model_names(body), vec!["llama3.2:3b", "qwen2.5:7b"]);
        assert_eq!(model_names("<html>"), Vec::<String>::new());
    }

    #[test]
    fn the_request_body_carries_the_system_prompt_where_each_format_wants_it() {
        let request = AskRequest {
            id: "1".into(),
            slot: "claude".into(),
            kind: ProviderKind::Anthropic,
            base_url: "https://api.anthropic.com".into(),
            model: "claude-sonnet-5-5".into(),
            max_tokens: 100_000,
            system: "Be brief.".into(),
            messages: vec![ChatMessage { role: "user".into(), content: "Hi".into() }],
        };
        let body = request_body(&request);
        assert_eq!(body["system"], "Be brief.");
        assert_eq!(body["max_tokens"], 4096);
        assert_eq!(body["messages"][0]["role"], "user");
        let openai = AskRequest { kind: ProviderKind::OpenAi, ..request };
        let body = request_body(&openai);
        assert_eq!(body["messages"][0], serde_json::json!({ "role": "system", "content": "Be brief." }));
        assert_eq!(body["messages"][1]["content"], "Hi");
        assert!(body.get("system").is_none());
    }

    /// A one-shot HTTP server on this computer: reads the first request, then answers with `status`
    /// (or, for None, never answers) and writes each chunk after its pause in milliseconds.
    /// Returns its base URL.
    fn serve_script(status: Option<&'static str>, chunks: Vec<(u64, Vec<u8>)>) -> String {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut seen = Vec::new();
            let mut buf = [0u8; 4096];
            while !seen.windows(4).any(|w| w == b"\r\n\r\n") {
                let n = socket.read(&mut buf).unwrap();
                if n == 0 { return; }
                seen.extend_from_slice(&buf[..n]);
            }
            let Some(status) = status else {
                std::thread::sleep(std::time::Duration::from_secs(5));
                return;
            };
            let head = format!("HTTP/1.1 {status}\r\ncontent-type: text/event-stream\r\nconnection: close\r\n\r\n");
            if socket.write_all(head.as_bytes()).is_err() { return; }
            for (pause, chunk) in chunks {
                std::thread::sleep(std::time::Duration::from_millis(pause));
                if socket.write_all(&chunk).is_err() { return; }
                let _ = socket.flush();
            }
        });
        format!("http://127.0.0.1:{port}/v1")
    }

    fn serve(status: &'static str, chunks: Vec<Vec<u8>>) -> String {
        serve_script(Some(status), chunks.into_iter().map(|c| (20, c)).collect())
    }

    fn cancelled() -> Cancel {
        let cancel = Cancel::default();
        cancel.cancel();
        cancel
    }

    fn openai_text(text: &str) -> Vec<u8> {
        format!("data: {{\"choices\":[{{\"delta\":{{\"content\":\"{text}\"}}}}]}}\n").into_bytes()
    }

    fn ask(kind: ProviderKind) -> AskRequest {
        AskRequest {
            id: "t".into(),
            slot: "ollama".into(),
            kind,
            base_url: String::new(),
            model: "m".into(),
            max_tokens: 50,
            system: "s".into(),
            messages: vec![ChatMessage { role: "user".into(), content: "q".into() }],
        }
    }

    fn local_client() -> reqwest::Client {
        client_builder().no_proxy().build().unwrap()
    }

    #[tokio::test]
    async fn streams_an_answer_whose_lines_and_characters_are_split_across_chunks() {
        let line1 = "data: {\"choices\":[{\"delta\":{\"content\":\"Dober \"}}]}\n".as_bytes().to_vec();
        let line2 = "data: {\"choices\":[{\"delta\":{\"content\":\"dan, Č\"}}]}\n\ndata: [DONE]\n".as_bytes().to_vec();
        // Cut inside the first line, and inside the two bytes of "Č".
        let cut = line2.iter().position(|b| *b == 0xC4).unwrap() + 1;
        let chunks = vec![line1[..10].to_vec(), line1[10..].to_vec(), line2[..cut].to_vec(), line2[cut..].to_vec()];
        let base = serve("200 OK", chunks);
        let mut pieces = Vec::new();
        let answer = stream_answer(&local_client(), &ask(ProviderKind::OpenAi), &base, None, &Cancel::default(), LIMITS, |t| pieces.push(t.to_string()))
            .await
            .unwrap();
        assert_eq!(answer, "Dober dan, Č");
        assert_eq!(pieces, vec!["Dober ", "dan, Č"]);
    }

    #[tokio::test]
    async fn an_anthropic_stream_ends_at_message_stop() {
        let body = concat!(
            "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{}}\n\n",
            "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"OK\"}}\n\n",
            "event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n",
            "data: {\"type\":\"content_block_delta\",\"delta\":{\"text\":\"after the end\"}}\n"
        );
        let base = serve("200 OK", vec![body.as_bytes().to_vec()]);
        let answer = stream_answer(&local_client(), &ask(ProviderKind::Anthropic), &base, Some("k"), &Cancel::default(), LIMITS, |_| {})
            .await
            .unwrap();
        assert_eq!(answer, "OK");
    }

    #[tokio::test]
    async fn a_refusal_is_said_and_an_error_in_the_stream_stops_it() {
        let base = serve("401 Unauthorized", vec![br#"{"error":{"message":"invalid key"}}"#.to_vec()]);
        let err = stream_answer(&local_client(), &ask(ProviderKind::OpenAi), &base, Some("k"), &Cancel::default(), LIMITS, |_| {})
            .await
            .unwrap_err();
        assert_eq!(err, "The key was not accepted. It said: invalid key");

        let base = serve("200 OK", vec![b"data: {\"error\":{\"message\":\"out of memory\"}}\n".to_vec()]);
        let err = stream_answer(&local_client(), &ask(ProviderKind::OpenAi), &base, None, &Cancel::default(), LIMITS, |_| {})
            .await
            .unwrap_err();
        assert_eq!(err, "The model stopped with an error: out of memory");
    }

    #[tokio::test]
    async fn a_cancelled_request_reads_nothing_more() {
        let base = serve("200 OK", vec![b"data: {\"choices\":[{\"delta\":{\"content\":\"never\"}}]}\n".to_vec()]);
        let answer = stream_answer(&local_client(), &ask(ProviderKind::OpenAi), &base, None, &cancelled(), LIMITS, |_| {})
            .await
            .unwrap();
        assert_eq!(answer, "");
    }

    #[tokio::test]
    async fn an_address_nothing_listens_on_is_said_as_such() {
        let port = std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        let base = format!("http://127.0.0.1:{port}/v1");
        let err = stream_answer(&local_client(), &ask(ProviderKind::OpenAi), &base, None, &Cancel::default(), LIMITS, |_| {})
            .await
            .unwrap_err();
        assert_eq!(err, "The model server could not be reached. Is it running, and is the address right?");
    }

    #[tokio::test]
    async fn stop_interrupts_a_read_that_is_waiting_and_keeps_what_arrived() {
        let base = serve_script(Some("200 OK"), vec![(0, openai_text("first")), (3000, openai_text(" never"))]);
        let cancel = Arc::new(Cancel::default());
        let stopper = cancel.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(300)).await;
            stopper.cancel();
        });
        let started = std::time::Instant::now();
        let answer = stream_answer(&local_client(), &ask(ProviderKind::OpenAi), &base, None, &cancel, LIMITS, |_| {})
            .await
            .unwrap();
        assert_eq!(answer, "first");
        assert!(started.elapsed() < Duration::from_millis(1500), "{:?}", started.elapsed());
    }

    #[tokio::test]
    async fn a_server_that_never_begins_its_answer_is_given_up_on() {
        let base = serve_script(None, vec![]);
        let limits = Limits { headers: Duration::from_millis(200), ..LIMITS };
        let err = stream_answer(&local_client(), &ask(ProviderKind::OpenAi), &base, None, &Cancel::default(), limits, |_| {})
            .await
            .unwrap_err();
        assert_eq!(err, "The model server did not answer in time.");
    }

    #[tokio::test]
    async fn a_page_that_is_not_a_stream_is_no_answer() {
        let base = serve("200 OK", vec![b"<html><body>Welcome to nginx</body></html>\n".to_vec()]);
        let err = stream_answer(&local_client(), &ask(ProviderKind::OpenAi), &base, None, &Cancel::default(), LIMITS, |_| {})
            .await
            .unwrap_err();
        assert_eq!(err, "The server answered, but not with a model's reply. Check the address and the model.");
    }

    #[tokio::test]
    async fn a_line_that_never_ends_and_an_answer_past_the_cap_are_bounded() {
        let limits = Limits { max_line: 64, ..LIMITS };
        let base = serve("200 OK", vec![vec![b'x'; 200]]);
        let err = stream_answer(&local_client(), &ask(ProviderKind::OpenAi), &base, None, &Cancel::default(), limits, |_| {})
            .await
            .unwrap_err();
        assert_eq!(err, "The model server sent something that is not an answer.");

        let limits = Limits { max_answer: 7, ..LIMITS };
        let mut both = openai_text("Hello");
        both.extend(openai_text(", wörld"));
        let base = serve("200 OK", vec![both]);
        let mut pieces = Vec::new();
        let answer = stream_answer(&local_client(), &ask(ProviderKind::OpenAi), &base, None, &Cancel::default(), limits, |t| pieces.push(t.to_string()))
            .await
            .unwrap();
        assert_eq!(answer, "Hello, ");
        assert_eq!(pieces, vec!["Hello", ", "]);
    }

    #[test]
    fn clips_without_cutting_a_character() {
        assert_eq!(clip_bytes("wörld", 2), "w");
        assert_eq!(clip_bytes("wörld", 3), "wö");
        assert_eq!(clip_bytes("abc", 10), "abc");
    }

    #[test]
    fn a_key_travels_only_over_https_or_to_this_computer() {
        assert!(key_may_travel("https://api.example.com/v1").is_ok());
        assert!(key_may_travel("http://localhost:1234/v1").is_ok());
        assert!(key_may_travel("http://127.0.0.1:1234/v1").is_ok());
        assert_eq!(
            key_may_travel("http://192.168.1.5:1234/v1").unwrap_err(),
            "A key is only sent over https, or to a server on this computer."
        );
        assert!(key_for(saved("http://llm.example/v1"), "http://llm.example/v1").is_err());
        assert_eq!(key_for(None, "http://llm.example/v1").unwrap(), None);
    }

    #[test]
    fn a_socks5_proxy_looks_the_name_up_itself() {
        assert_eq!(assistant_proxy("socks5://127.0.0.1:9050"), "socks5h://127.0.0.1:9050");
        assert_eq!(assistant_proxy("socks5h://127.0.0.1:9050"), "socks5h://127.0.0.1:9050");
        assert_eq!(assistant_proxy("http://proxy.example:8080"), "http://proxy.example:8080");
    }

    #[tokio::test]
    async fn a_redirect_is_not_followed_and_the_key_goes_nowhere_else() {
        use std::io::{Read, Write};
        use std::sync::atomic::AtomicBool;
        // Where the redirect points: it must never be asked.
        let elsewhere = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let elsewhere_port = elsewhere.local_addr().unwrap().port();
        elsewhere.set_nonblocking(true).unwrap();
        let reached = Arc::new(AtomicBool::new(false));
        let seen = reached.clone();
        std::thread::spawn(move || {
            for _ in 0..50 {
                if elsewhere.accept().is_ok() {
                    seen.store(true, Ordering::Relaxed);
                    return;
                }
                std::thread::sleep(Duration::from_millis(20));
            }
        });
        let server = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = server.local_addr().unwrap().port();
        std::thread::spawn(move || {
            let (mut socket, _) = server.accept().unwrap();
            let mut buf = [0u8; 4096];
            let _ = socket.read(&mut buf);
            let reply = format!(
                "HTTP/1.1 307 Temporary Redirect\r\nlocation: http://127.0.0.1:{elsewhere_port}/v1/messages\r\ncontent-length: 0\r\nconnection: close\r\n\r\n"
            );
            let _ = socket.write_all(reply.as_bytes());
        });
        let base = format!("http://127.0.0.1:{port}");
        let err = stream_answer(&local_client(), &ask(ProviderKind::Anthropic), &base, Some("sk-ant-secret"), &Cancel::default(), LIMITS, |_| {})
            .await
            .unwrap_err();
        assert_eq!(err, "The server sent Vega to another address, which it does not follow with your request. Check the address.");
        std::thread::sleep(Duration::from_millis(300));
        assert!(!reached.load(Ordering::Relaxed), "the redirect was followed");
    }
}
