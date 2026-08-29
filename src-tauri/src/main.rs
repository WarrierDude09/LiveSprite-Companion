#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, State, WebviewWindow,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt as AutostartExt};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_plugin_opener::OpenerExt;

const DEFAULT_GATEWAY: &str =
    "https://live-png-flow.base44.app/functions/CompanionGateway";
const LIVE_SPRITE_URL: &str = "https://live-png-flow.base44.app";
const VERSION: &str = "1.0.0";
const TRAY_ID: &str = "main-tray";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CompanionConfig {
    #[serde(default)]
    pair_token: String,
    #[serde(default = "default_gateway")]
    gateway_url: String,
    #[serde(default)]
    start_with_os: bool,
}

impl Default for CompanionConfig {
    fn default() -> Self {
        Self {
            pair_token: String::new(),
            gateway_url: default_gateway(),
            start_with_os: false,
        }
    }
}

fn default_gateway() -> String {
    DEFAULT_GATEWAY.to_owned()
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Binding {
    id: String,
    #[allow(dead_code)]
    action_type: String,
    #[allow(dead_code)]
    action: String,
    #[allow(dead_code)]
    target_id: String,
    #[allow(dead_code)]
    target_name: String,
    key: String,
    #[serde(default)]
    modifiers: Vec<String>,
    mode: String,
    enabled: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncResponse {
    bindings: Vec<Binding>,
    #[serde(default)]
    hotkeys_paused: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HeartbeatResponse {
    #[allow(dead_code)]
    ok: bool,
    #[serde(default)]
    hotkeys_paused: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PairingConfigView {
    pair_token: String,
    gateway_url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PairResult {
    registered_count: usize,
    conflicts: Vec<String>,
}

struct AppState {
    config: Mutex<CompanionConfig>,
    config_path: PathBuf,
    bindings: Mutex<HashMap<u32, Binding>>,
    conflicts: Mutex<Vec<String>>,
    registered_count: Mutex<usize>,
    paused: AtomicBool,
    syncing: AtomicBool,
    synced: AtomicBool,
    client: Client,
    status_item: Mutex<Option<MenuItem<tauri::Wry>>>,
    autostart_item: Mutex<Option<MenuItem<tauri::Wry>>>,
}

impl AppState {
    fn config(&self) -> CompanionConfig {
        self.config.lock().expect("config lock poisoned").clone()
    }
}

#[tauri::command]
fn get_pairing_config(state: State<'_, Arc<AppState>>) -> PairingConfigView {
    let config = state.config();
    PairingConfigView {
        pair_token: config.pair_token,
        gateway_url: config.gateway_url,
    }
}

#[tauri::command]
async fn pair_companion(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    pair_token: String,
    gateway_url: String,
) -> Result<PairResult, String> {
    if pair_token.trim().is_empty() {
        return Err("Enter a pairing token.".into());
    }
    let gateway_url = gateway_url.trim().trim_end_matches('/').to_owned();
    reqwest::Url::parse(&gateway_url).map_err(|_| "Enter a valid Gateway URL.".to_string())?;

    // Validate before replacing a known-good saved pairing.
    fetch_sync(&state.client, &gateway_url, pair_token.trim()).await?;
    {
        let mut config = state.config.lock().map_err(|_| "Config is unavailable")?;
        config.pair_token = pair_token.trim().to_owned();
        config.gateway_url = gateway_url;
        save_config(&state.config_path, &config)?;
    }
    sync_and_register(&app, state.inner().clone()).await
}

#[tauri::command]
fn hide_pairing_window(window: WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|error| error.to_string())
}

fn load_config(path: &PathBuf) -> CompanionConfig {
    fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn save_config(path: &PathBuf, config: &CompanionConfig) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let json = serde_json::to_string_pretty(config).map_err(|error| error.to_string())?;
    fs::write(path, json).map_err(|error| error.to_string())
}

async fn gateway_post<T: for<'de> Deserialize<'de>>(
    client: &Client,
    url: &str,
    body: serde_json::Value,
) -> Result<T, String> {
    let response = client
        .post(url)
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("Cannot reach the LiveSprite gateway: {error}"))?;
    let status = response.status();
    if !status.is_success() {
        let message = response.text().await.unwrap_or_default();
        return Err(if status.as_u16() == 401 || status.as_u16() == 403 {
            "The pairing token is invalid or expired.".into()
        } else {
            format!("Gateway returned {status}: {message}")
        });
    }
    response
        .json::<T>()
        .await
        .map_err(|error| format!("Invalid gateway response: {error}"))
}

async fn fetch_sync(client: &Client, url: &str, token: &str) -> Result<SyncResponse, String> {
    gateway_post(
        client,
        url,
        serde_json::json!({ "action": "sync", "pairToken": token }),
    )
    .await
}

struct SyncGuard(Arc<AppState>);
impl Drop for SyncGuard {
    fn drop(&mut self) {
        self.0.syncing.store(false, Ordering::Release);
    }
}

async fn sync_and_register(app: &AppHandle, state: Arc<AppState>) -> Result<PairResult, String> {
    if state.syncing.swap(true, Ordering::AcqRel) {
        return Err("A hotkey sync is already in progress.".into());
    }
    let _guard = SyncGuard(state.clone());
    let config = state.config();
    if config.pair_token.is_empty() {
        update_status(&state, "Status: Not paired");
        return Err("Pair the companion first.".into());
    }
    state.synced.store(false, Ordering::Release);

    let response = fetch_sync(&state.client, &config.gateway_url, &config.pair_token).await?;
    app.global_shortcut()
        .unregister_all()
        .map_err(|error| error.to_string())?;

    let mut registered = HashMap::new();
    let mut conflicts = Vec::new();
    for binding in response.bindings.into_iter().filter(|binding| binding.enabled) {
        let accelerator = match to_accelerator(&binding) {
            Ok(value) => value,
            Err(error) => {
                conflicts.push(error);
                continue;
            }
        };
        let shortcut: Shortcut = match accelerator.parse() {
            Ok(value) => value,
            Err(error) => {
                conflicts.push(format!("{accelerator}: {error}"));
                continue;
            }
        };
        match app.global_shortcut().register(shortcut) {
            Ok(()) => {
                registered.insert(shortcut.id(), binding);
            }
            Err(error) => conflicts.push(format!("{accelerator}: {error}")),
        }
    }

    let count = registered.len();
    *state.bindings.lock().expect("bindings lock poisoned") = registered;
    *state.conflicts.lock().expect("conflicts lock poisoned") = conflicts.clone();
    *state.registered_count.lock().expect("count lock poisoned") = count;
    state.paused.store(response.hotkeys_paused, Ordering::Release);
    state.synced.store(true, Ordering::Release);
    update_connected_status(&state);
    Ok(PairResult {
        registered_count: count,
        conflicts,
    })
}

fn to_accelerator(binding: &Binding) -> Result<String, String> {
    let mut parts = Vec::new();
    for modifier in ["ctrl", "shift", "alt"] {
        if binding
            .modifiers
            .iter()
            .any(|value| value.eq_ignore_ascii_case(modifier))
        {
            parts.push(match modifier {
                "ctrl" => "Control".to_owned(),
                "shift" => "Shift".to_owned(),
                _ => "Alt".to_owned(),
            });
        }
    }
    let raw = binding.key.trim();
    let upper = raw.to_ascii_uppercase();
    let key = if upper.len() == 1 && upper.as_bytes()[0].is_ascii_alphabetic() {
        format!("Key{upper}")
    } else if upper.len() == 1 && upper.as_bytes()[0].is_ascii_digit() {
        format!("Digit{upper}")
    } else if upper.starts_with('F')
        && upper[1..].parse::<u8>().is_ok_and(|number| (1..=12).contains(&number))
    {
        upper
    } else {
        match upper.as_str() {
            "SPACE" => "Space",
            "ENTER" | "RETURN" => "Enter",
            "ESC" | "ESCAPE" => "Escape",
            "TAB" => "Tab",
            "BACKSPACE" => "Backspace",
            "DELETE" => "Delete",
            "INSERT" => "Insert",
            "HOME" => "Home",
            "END" => "End",
            "PAGEUP" => "PageUp",
            "PAGEDOWN" => "PageDown",
            "UP" | "ARROWUP" => "ArrowUp",
            "DOWN" | "ARROWDOWN" => "ArrowDown",
            "LEFT" | "ARROWLEFT" => "ArrowLeft",
            "RIGHT" | "ARROWRIGHT" => "ArrowRight",
            _ => return Err(format!("Unsupported key: {raw}")),
        }
        .to_owned()
    };
    parts.push(key);
    Ok(parts.join("+"))
}

fn dispatch_shortcut(app: &AppHandle, shortcut: &Shortcut, event_state: ShortcutState) {
    let state = app.state::<Arc<AppState>>().inner().clone();
    if state.paused.load(Ordering::Acquire) {
        return;
    }
    let binding = state
        .bindings
        .lock()
        .ok()
        .and_then(|bindings| bindings.get(&shortcut.id()).cloned());
    let Some(binding) = binding else { return };
    let release = matches!(event_state, ShortcutState::Released);
    if release && binding.mode != "hold" {
        return;
    }
    let config = state.config();
    if config.pair_token.is_empty() {
        return;
    }
    tauri::async_runtime::spawn(async move {
        let _: Result<serde_json::Value, String> = gateway_post(
            &state.client,
            &config.gateway_url,
            serde_json::json!({
                "action": "event",
                "pairToken": config.pair_token,
                "bindingId": binding.id,
                "release": release
            }),
        )
        .await;
    });
}

fn update_status(state: &AppState, text: &str) {
    if let Ok(item) = state.status_item.lock() {
        if let Some(item) = item.as_ref() {
            let _ = item.set_text(text);
        }
    }
}

fn update_connected_status(state: &AppState) {
    if state.paused.load(Ordering::Acquire) {
        update_status(state, "Status: Connected · Paused");
    } else {
        let count = *state.registered_count.lock().expect("count lock poisoned");
        update_status(state, &format!("Status: Connected · {count} hotkeys"));
    }
}

async fn heartbeat(app: &AppHandle, state: Arc<AppState>) -> Result<(), String> {
    let config = state.config();
    if config.pair_token.is_empty() {
        update_status(&state, "Status: Not paired");
        return Ok(());
    }
    let count = *state.registered_count.lock().map_err(|_| "count unavailable")?;
    let conflicts = state
        .conflicts
        .lock()
        .map_err(|_| "conflicts unavailable")?
        .clone();
    let response: HeartbeatResponse = gateway_post(
        &state.client,
        &config.gateway_url,
        serde_json::json!({
            "action": "heartbeat",
            "pairToken": config.pair_token,
            "registeredCount": count,
            "conflicts": conflicts,
            "version": VERSION
        }),
    )
    .await?;
    state.paused.store(response.hotkeys_paused, Ordering::Release);
    update_connected_status(&state);
    let _ = app; // retained for symmetry with reconnect calls
    Ok(())
}

fn start_heartbeat_loop(app: AppHandle, state: Arc<AppState>) {
    tauri::async_runtime::spawn(async move {
        let mut failures = 0u8;
        let mut interval = tokio::time::interval(Duration::from_secs(10));
        interval.tick().await;
        loop {
            interval.tick().await;
            match heartbeat(&app, state.clone()).await {
                Ok(()) => {
                    failures = 0;
                    if !state.synced.load(Ordering::Acquire) {
                        let _ = sync_and_register(&app, state.clone()).await;
                    }
                }
                Err(_) => {
                    failures = failures.saturating_add(1);
                    if failures >= 3 {
                        state.synced.store(false, Ordering::Release);
                        update_status(&state, "Status: Disconnected");
                        if sync_and_register(&app, state.clone()).await.is_ok() {
                            failures = 0;
                        }
                    }
                }
            }
        }
    });
}

fn show_pairing(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("pairing") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn spawn_sync(app: AppHandle) {
    let state = app.state::<Arc<AppState>>().inner().clone();
    tauri::async_runtime::spawn(async move {
        if sync_and_register(&app, state.clone()).await.is_err() {
            update_status(&state, "Status: Disconnected");
        }
    });
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    dispatch_shortcut(app, shortcut, event.state());
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            get_pairing_config,
            pair_companion,
            hide_pairing_window
        ])
        .setup(|app| {
            let config_path = app
                .path()
                .app_config_dir()?
                .join("companion.json");
            let mut config = load_config(&config_path);
            let actual_autostart = app.autolaunch().is_enabled().unwrap_or(config.start_with_os);
            config.start_with_os = actual_autostart;
            let _ = save_config(&config_path, &config);

            let state = Arc::new(AppState {
                config: Mutex::new(config.clone()),
                config_path,
                bindings: Mutex::new(HashMap::new()),
                conflicts: Mutex::new(Vec::new()),
                registered_count: Mutex::new(0),
                paused: AtomicBool::new(false),
                syncing: AtomicBool::new(false),
                synced: AtomicBool::new(false),
                client: Client::builder().timeout(Duration::from_secs(8)).build()?,
                status_item: Mutex::new(None),
                autostart_item: Mutex::new(None),
            });
            app.manage(state.clone());

            let status_text = if config.pair_token.is_empty() {
                "Status: Not paired"
            } else {
                "Status: Disconnected"
            };
            let status = MenuItem::with_id(app, "status", status_text, false, None::<&str>)?;
            let pair = MenuItem::with_id(app, "pair", "Pair…", true, None::<&str>)?;
            let resync = MenuItem::with_id(app, "resync", "Re-sync Hotkeys", true, None::<&str>)?;
            let pause = MenuItem::with_id(app, "pause", "Pause Hotkeys", true, None::<&str>)?;
            let autostart_label = if actual_autostart { "Disable autostart" } else { "Start with OS" };
            let autostart = MenuItem::with_id(app, "autostart", autostart_label, true, None::<&str>)?;
            let open = MenuItem::with_id(app, "open", "Open LiveSprite", true, None::<&str>)?;
            let exit = MenuItem::with_id(app, "exit", "Exit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&status, &pair, &resync, &pause, &autostart, &open, &exit])?;
            *state.status_item.lock().expect("status lock poisoned") = Some(status);
            *state.autostart_item.lock().expect("autostart lock poisoned") = Some(autostart);

            TrayIconBuilder::with_id(TRAY_ID)
                .icon(app.default_window_icon().cloned().expect("application icon missing"))
                .tooltip("LiveSprite Companion")
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "pair" => show_pairing(app),
                    "resync" => spawn_sync(app.clone()),
                    "pause" => {
                        let state = app.state::<Arc<AppState>>().inner().clone();
                        let app = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let paused = !state.paused.load(Ordering::Acquire);
                            let config = state.config();
                            let result: Result<serde_json::Value, String> = gateway_post(
                                &state.client,
                                &config.gateway_url,
                                serde_json::json!({ "action": "pause", "pairToken": config.pair_token, "paused": paused }),
                            ).await;
                            if result.is_ok() {
                                state.paused.store(paused, Ordering::Release);
                                update_connected_status(&state);
                            } else {
                                update_status(&state, "Status: Disconnected");
                            }
                            let _ = app;
                        });
                    }
                    "autostart" => {
                        let state = app.state::<Arc<AppState>>().inner().clone();
                        let currently_enabled = app.autolaunch().is_enabled().unwrap_or(false);
                        let result = if currently_enabled { app.autolaunch().disable() } else { app.autolaunch().enable() };
                        if result.is_ok() {
                            let enabled = !currently_enabled;
                            if let Ok(mut config) = state.config.lock() {
                                config.start_with_os = enabled;
                                let _ = save_config(&state.config_path, &config);
                            }
                            if let Ok(item) = state.autostart_item.lock() {
                                if let Some(item) = item.as_ref() {
                                    let _ = item.set_text(if enabled { "Disable autostart" } else { "Start with OS" });
                                }
                            }
                        }
                    }
                    "open" => { let _ = app.opener().open_url(LIVE_SPRITE_URL, None::<&str>); }
                    "exit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            start_heartbeat_loop(app.handle().clone(), state);
            if !config.pair_token.is_empty() {
                spawn_sync(app.handle().clone());
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running LiveSprite Companion");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn binding(key: &str, modifiers: &[&str]) -> Binding {
        Binding {
            id: "id".into(), action_type: "expression".into(), action: "x".into(),
            target_id: "target".into(), target_name: "Target".into(), key: key.into(),
            modifiers: modifiers.iter().map(|value| value.to_string()).collect(),
            mode: "press".into(), enabled: true,
        }
    }

    #[test]
    fn accelerator_mapping_is_canonical() {
        assert_eq!(to_accelerator(&binding("B", &["alt", "ctrl", "shift"])).unwrap(), "Control+Shift+Alt+KeyB");
        assert_eq!(to_accelerator(&binding("1", &[])).unwrap(), "Digit1");
        assert_eq!(to_accelerator(&binding("F12", &[])).unwrap(), "F12");
        assert_eq!(to_accelerator(&binding("Space", &[])).unwrap(), "Space");
    }
}
