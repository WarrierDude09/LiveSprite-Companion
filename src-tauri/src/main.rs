#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod audio;

use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, fs, path::PathBuf, sync::{atomic::{AtomicBool, Ordering}, Arc, Mutex}, time::Duration};
use tauri::{menu::{Menu, MenuItem}, tray::{TrayIconBuilder, TrayIconEvent}, AppHandle, Emitter, Manager, State, WindowEvent};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt as AutostartExt};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use audio::{AudioEngine, AudioStatus, VoiceConfig};

const DEFAULT_GATEWAY: &str = "https://live-png-flow.base44.app/functions/CompanionGateway";
const VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CompanionConfig {
    #[serde(default)] pair_token: String,
    #[serde(default = "default_gateway")] gateway_url: String,
    #[serde(default)] start_with_os: bool,
    #[serde(default)] active_project_id: String,
    #[serde(default)] active_project_name: String,
    #[serde(default = "default_true")] close_to_tray: bool,
}
impl Default for CompanionConfig { fn default() -> Self { Self { pair_token:String::new(), gateway_url:default_gateway(), start_with_os:false, active_project_id:String::new(), active_project_name:String::new(), close_to_tray:true } } }
fn default_gateway() -> String { DEFAULT_GATEWAY.into() }
fn default_true() -> bool { true }

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Binding {
    id:String, #[allow(dead_code)] action_type:String, #[allow(dead_code)] action:String,
    #[allow(dead_code)] target_id:String, #[allow(dead_code)] target_name:String,
    key:String, #[serde(default)] modifiers:Vec<String>, mode:String, enabled:bool,
}
#[derive(Deserialize)] #[serde(rename_all="camelCase")]
struct SyncResponse { bindings:Vec<Binding>, #[serde(default)] hotkeys_paused:bool }
#[derive(Deserialize)] #[serde(rename_all="camelCase")]
struct HeartbeatResponse { #[allow(dead_code)] ok:bool, #[serde(default)] hotkeys_paused:bool }
#[derive(Serialize)] #[serde(rename_all="camelCase")]
struct PairResult { registered_count:usize, conflicts:Vec<String> }
#[derive(Serialize)] #[serde(rename_all="camelCase")]
struct CompanionStatus {
    paired:bool, connected:bool, paused:bool, registered_count:usize, conflicts:Vec<String>,
    gateway_url:String, autostart:bool, close_to_tray:bool, version:&'static str,
    active_project_id:String, active_project_name:String,
}

struct AppState {
    config:Mutex<CompanionConfig>, config_path:PathBuf, bindings:Mutex<HashMap<u32,Binding>>,
    conflicts:Mutex<Vec<String>>, registered_count:Mutex<usize>, paused:AtomicBool,
    syncing:AtomicBool, synced:AtomicBool, client:Client,
    event_lock:tokio::sync::Mutex<()>,
    status_item:Mutex<Option<MenuItem<tauri::Wry>>>, project_item:Mutex<Option<MenuItem<tauri::Wry>>>,
    voice_item:Mutex<Option<MenuItem<tauri::Wry>>>, pause_item:Mutex<Option<MenuItem<tauri::Wry>>>, autostart_item:Mutex<Option<MenuItem<tauri::Wry>>>,
    audio: AudioEngine,
}
impl AppState { fn config(&self)->CompanionConfig { self.config.lock().expect("config lock").clone() } }

#[tauri::command]
fn get_companion_status(app:AppHandle,state:State<'_,Arc<AppState>>)->CompanionStatus {
    let c=state.config(); CompanionStatus { paired:!c.pair_token.is_empty(), connected:state.synced.load(Ordering::Acquire),
        paused:state.paused.load(Ordering::Acquire), registered_count:*state.registered_count.lock().expect("count lock"),
        conflicts:state.conflicts.lock().expect("conflicts lock").clone(), gateway_url:c.gateway_url,
        autostart:app.autolaunch().is_enabled().unwrap_or(c.start_with_os), close_to_tray:c.close_to_tray,
        version:VERSION, active_project_id:c.active_project_id, active_project_name:c.active_project_name }
}

#[tauri::command]
async fn activate_project_pairing(app:AppHandle,state:State<'_,Arc<AppState>>,pair_token:String,gateway_url:Option<String>,project_id:String,project_name:String)->Result<PairResult,String>{
    if pair_token.trim().is_empty()||project_id.trim().is_empty(){return Err("The backend did not return a valid project pairing.".into())}
    let url=gateway_url.unwrap_or_else(default_gateway).trim().trim_end_matches('/').to_owned();
    reqwest::Url::parse(&url).map_err(|_|"Invalid gateway URL".to_string())?;
    fetch_sync(&state.client,&url,pair_token.trim()).await?;
    {let mut c=state.config.lock().map_err(|_|"Config unavailable")?; c.pair_token=pair_token.trim().into(); c.gateway_url=url; c.active_project_id=project_id; c.active_project_name=project_name; save_config(&state.config_path,&c)?;}
    update_project(&state); sync_and_register(&app,state.inner().clone()).await
}
#[tauri::command]
async fn resync_hotkeys(app:AppHandle,state:State<'_,Arc<AppState>>)->Result<PairResult,String>{sync_and_register(&app,state.inner().clone()).await}
#[tauri::command]
async fn set_hotkeys_paused(state:State<'_,Arc<AppState>>,paused:bool)->Result<(),String>{set_paused(state.inner(),paused).await}
#[tauri::command]
fn set_autostart(app:AppHandle,state:State<'_,Arc<AppState>>,enabled:bool)->Result<(),String>{
    if enabled{app.autolaunch().enable()}else{app.autolaunch().disable()}.map_err(|e|e.to_string())?;
    let mut c=state.config.lock().map_err(|_|"Config unavailable")?; c.start_with_os=enabled; save_config(&state.config_path,&c)?; update_autostart(&state,enabled); Ok(())
}
#[tauri::command]
fn disconnect_companion(app:AppHandle,state:State<'_,Arc<AppState>>)->Result<(),String>{
    app.global_shortcut().unregister_all().map_err(|e|e.to_string())?;
    {let mut c=state.config.lock().map_err(|_|"Config unavailable")?; c.pair_token.clear();c.active_project_id.clear();c.active_project_name.clear();save_config(&state.config_path,&c)?;}
    state.bindings.lock().expect("bindings lock").clear();state.conflicts.lock().expect("conflicts lock").clear();*state.registered_count.lock().expect("count lock")=0;
    state.synced.store(false,Ordering::Release);state.paused.store(false,Ordering::Release);update_status(&state,"Status: Not paired");update_project(&state);Ok(())
}
#[tauri::command] fn show_main_window(app:AppHandle)->Result<(),String>{show_main(&app)}
#[tauri::command] fn exit_application(app:AppHandle){app.exit(0)}
#[tauri::command] fn list_microphones(state:State<'_,Arc<AppState>>)->Result<Vec<String>,String>{state.audio.devices()}
#[tauri::command] fn start_voice_engine(app:AppHandle,state:State<'_,Arc<AppState>>,config:VoiceConfig)->Result<(),String>{state.audio.start(config,app)?;update_voice(&state,true);Ok(())}
#[tauri::command] fn stop_voice_engine(state:State<'_,Arc<AppState>>){state.audio.stop();update_voice(&state,false)}
#[tauri::command] fn get_audio_status(state:State<'_,Arc<AppState>>)->AudioStatus{let status=state.audio.status();update_voice(&state,status.running);status}
#[tauri::command]
fn open_external(url:String)->Result<(),String>{let parsed=reqwest::Url::parse(&url).map_err(|_|"Invalid URL".to_string())?;if parsed.scheme()!="https"||parsed.host_str()!=Some("live-png-flow.base44.app")||!parsed.path().starts_with("/live/"){return Err("Only LiveSprite streaming preview links can be opened.".into())}open::that_detached(parsed.as_str()).map_err(|e|e.to_string())}
#[tauri::command]
async fn test_hotkey_action(app:AppHandle,state:State<'_,Arc<AppState>>,binding_id:String,mode:String)->Result<(),String>{
    if binding_id.trim().is_empty(){return Err("Select a valid hotkey action first.".into())}
    send_binding_event(&app,state.inner(),binding_id.trim(),false).await?;
    if mode.eq_ignore_ascii_case("hold"){send_binding_event(&app,state.inner(),binding_id.trim(),true).await?}
    Ok(())
}

fn load_config(path:&PathBuf)->CompanionConfig{fs::read_to_string(path).ok().and_then(|v|serde_json::from_str(&v).ok()).unwrap_or_default()}
fn save_config(path:&PathBuf,c:&CompanionConfig)->Result<(),String>{if let Some(p)=path.parent(){fs::create_dir_all(p).map_err(|e|e.to_string())?}fs::write(path,serde_json::to_string_pretty(c).map_err(|e|e.to_string())?).map_err(|e|e.to_string())}
async fn post<T:for<'a>Deserialize<'a>>(client:&Client,url:&str,body:serde_json::Value)->Result<T,String>{
    let response=client.post(url).json(&body).send().await.map_err(|e|format!("Cannot reach LiveSprite: {e}"))?;let status=response.status();
    if !status.is_success(){let message=response.text().await.unwrap_or_default();return Err(if [401,403].contains(&status.as_u16()){"The project pairing is invalid or expired.".into()}else{format!("Gateway returned {status}: {message}")})}
    response.json().await.map_err(|e|format!("Invalid gateway response: {e}"))
}
async fn fetch_sync(client:&Client,url:&str,token:&str)->Result<SyncResponse,String>{post(client,url,serde_json::json!({"action":"sync","pairToken":token})).await}

struct SyncGuard(Arc<AppState>);impl Drop for SyncGuard{fn drop(&mut self){self.0.syncing.store(false,Ordering::Release)}}
async fn sync_and_register(app:&AppHandle,state:Arc<AppState>)->Result<PairResult,String>{
    if state.syncing.swap(true,Ordering::AcqRel){return Err("A hotkey sync is already in progress.".into())}let _guard=SyncGuard(state.clone());let c=state.config();
    if c.pair_token.is_empty(){update_status(&state,"Status: Not paired");return Err("No native project is active.".into())}state.synced.store(false,Ordering::Release);
    let response=fetch_sync(&state.client,&c.gateway_url,&c.pair_token).await?;app.global_shortcut().unregister_all().map_err(|e|e.to_string())?;
    let mut registered=HashMap::new();let mut conflicts=Vec::new();
    for binding in response.bindings.into_iter().filter(|b|b.enabled){let accel=match to_accelerator(&binding){Ok(v)=>v,Err(e)=>{conflicts.push(e);continue}};
        let shortcut:Shortcut=match accel.parse(){Ok(v)=>v,Err(e)=>{conflicts.push(format!("{accel}: {e}"));continue}};
        match app.global_shortcut().register(shortcut){Ok(())=>{registered.insert(shortcut.id(),binding);},Err(e)=>conflicts.push(format!("{accel}: {e}"))}}
    let count=registered.len();*state.bindings.lock().expect("bindings lock")=registered;*state.conflicts.lock().expect("conflicts lock")=conflicts.clone();*state.registered_count.lock().expect("count lock")=count;
    state.paused.store(response.hotkeys_paused,Ordering::Release);state.synced.store(true,Ordering::Release);update_connected(&state);Ok(PairResult{registered_count:count,conflicts})
}

fn to_accelerator(binding:&Binding)->Result<String,String>{
    let mut p=Vec::new();for m in ["ctrl","shift","alt","super"]{if binding.modifiers.iter().any(|v|v.eq_ignore_ascii_case(m)||m=="super"&&(v.eq_ignore_ascii_case("meta")||v.eq_ignore_ascii_case("command")||v.eq_ignore_ascii_case("win"))){p.push(match m{"ctrl"=>"Control","shift"=>"Shift","alt"=>"Alt",_=>"Super"}.to_owned())}}
    let raw=binding.key.trim();let upper=raw.to_ascii_uppercase();let key=if upper.len()==1&&upper.as_bytes()[0].is_ascii_alphabetic(){format!("Key{upper}")}
    else if upper.len()==1&&upper.as_bytes()[0].is_ascii_digit(){format!("Digit{upper}")}
    else if upper.starts_with('F')&&upper[1..].parse::<u8>().is_ok_and(|n|(1..=24).contains(&n)){upper}
    else{match upper.as_str(){"SPACE"=>"Space","ENTER"|"RETURN"=>"Enter","ESC"|"ESCAPE"=>"Escape","TAB"=>"Tab","BACKSPACE"=>"Backspace","DELETE"=>"Delete","INSERT"=>"Insert","HOME"=>"Home","END"=>"End","PAGEUP"=>"PageUp","PAGEDOWN"=>"PageDown","UP"|"ARROWUP"=>"ArrowUp","DOWN"|"ARROWDOWN"=>"ArrowDown","LEFT"|"ARROWLEFT"=>"ArrowLeft","RIGHT"|"ARROWRIGHT"=>"ArrowRight","BACKQUOTE"=>"Backquote","MINUS"=>"Minus","EQUAL"=>"Equal","BRACKETLEFT"=>"BracketLeft","BRACKETRIGHT"=>"BracketRight","BACKSLASH"=>"Backslash","SEMICOLON"=>"Semicolon","QUOTE"=>"Quote","COMMA"=>"Comma","PERIOD"=>"Period","SLASH"=>"Slash","NUMPAD0"=>"Numpad0","NUMPAD1"=>"Numpad1","NUMPAD2"=>"Numpad2","NUMPAD3"=>"Numpad3","NUMPAD4"=>"Numpad4","NUMPAD5"=>"Numpad5","NUMPAD6"=>"Numpad6","NUMPAD7"=>"Numpad7","NUMPAD8"=>"Numpad8","NUMPAD9"=>"Numpad9","NUMPADADD"=>"NumpadAdd","NUMPADSUBTRACT"=>"NumpadSubtract","NUMPADMULTIPLY"=>"NumpadMultiply","NUMPADDIVIDE"=>"NumpadDivide","NUMPADDECIMAL"=>"NumpadDecimal",_=>return Err(format!("Unsupported key: {raw}"))}.to_owned()};p.push(key);Ok(p.join("+"))
}
async fn send_binding_event(app:&AppHandle,state:&Arc<AppState>,binding_id:&str,release:bool)->Result<(),String>{let _order=state.event_lock.lock().await;let c=state.config();let result:Result<serde_json::Value,String>=post(&state.client,&c.gateway_url,serde_json::json!({"action":"event","pairToken":c.pair_token,"bindingId":binding_id,"release":release})).await;if let Err(reason)=&result{let _=app.emit("native-error",format!("Hotkey action failed: {reason}"));}result.map(|_|())}
fn dispatch(app:&AppHandle,shortcut:&Shortcut,event:ShortcutState){let state=app.state::<Arc<AppState>>().inner().clone();if state.paused.load(Ordering::Acquire)||!state.synced.load(Ordering::Acquire){return}
    let binding=state.bindings.lock().ok().and_then(|v|v.get(&shortcut.id()).cloned());let Some(binding)=binding else{return};let release=matches!(event,ShortcutState::Released);if release&&binding.mode!="hold"{return}
    let app=app.clone();tauri::async_runtime::spawn(async move{let _=send_binding_event(&app,&state,&binding.id,release).await;});}

fn update_status(s: &AppState, text: &str) {
    if let Ok(item) = s.status_item.lock() {
        if let Some(item) = item.as_ref() { let _ = item.set_text(text); }
    }
}
fn update_project(s: &AppState) {
    let name = s.config().active_project_name;
    let text = if name.is_empty() { "Active Project: None".into() } else { format!("Active Project: {name}") };
    if let Ok(item) = s.project_item.lock() {
        if let Some(item) = item.as_ref() { let _ = item.set_text(text); }
    }
}
fn update_pause(s: &AppState) {
    let text = if s.paused.load(Ordering::Acquire) { "Resume Hotkeys" } else { "Pause Hotkeys" };
    if let Ok(item) = s.pause_item.lock() {
        if let Some(item) = item.as_ref() { let _ = item.set_text(text); }
    }
}
fn update_voice(s: &AppState, running: bool) {
    if let Ok(item) = s.voice_item.lock() {
        if let Some(item) = item.as_ref() { let _ = item.set_text(if running { "Voice Detection: Active" } else { "Voice Detection: Stopped" }); }
    }
}
fn update_autostart(s: &AppState, on: bool) {
    if let Ok(item) = s.autostart_item.lock() {
        if let Some(item) = item.as_ref() { let _ = item.set_text(if on { "Disable autostart" } else { "Start with OS" }); }
    }
}
fn update_connected(s: &AppState) {
    if s.paused.load(Ordering::Acquire) { update_status(s, "Status: Connected · Paused"); }
    else { let n = *s.registered_count.lock().expect("count lock"); update_status(s, &format!("Status: Connected · {n} hotkeys")); }
    update_pause(s);
}
async fn set_paused(s:&Arc<AppState>,paused:bool)->Result<(),String>{let c=s.config();if c.pair_token.is_empty(){return Err("No native project is active.".into())}let _:serde_json::Value=post(&s.client,&c.gateway_url,serde_json::json!({"action":"pause","pairToken":c.pair_token,"paused":paused})).await?;s.paused.store(paused,Ordering::Release);update_connected(s);Ok(())}
async fn heartbeat(s:Arc<AppState>)->Result<(),String>{let c=s.config();if c.pair_token.is_empty(){update_status(&s,"Status: Not paired");return Ok(())}let count=*s.registered_count.lock().map_err(|_|"count unavailable")?;let conflicts=s.conflicts.lock().map_err(|_|"conflicts unavailable")?.clone();
    let r:HeartbeatResponse=post(&s.client,&c.gateway_url,serde_json::json!({"action":"heartbeat","pairToken":c.pair_token,"registeredCount":count,"conflicts":conflicts,"version":VERSION})).await?;s.paused.store(r.hotkeys_paused,Ordering::Release);update_connected(&s);Ok(())}
fn start_heartbeat(app: AppHandle, s: Arc<AppState>) {
    tauri::async_runtime::spawn(async move {
        let mut failures = 0u8;
        let mut interval = tokio::time::interval(Duration::from_secs(10));
        interval.tick().await;
        loop {
            interval.tick().await;
            match heartbeat(s.clone()).await {
                Ok(()) => {
                    failures = 0;
                    if !s.synced.load(Ordering::Acquire) && !s.config().pair_token.is_empty() {
                        let _ = sync_and_register(&app, s.clone()).await;
                    }
                }
                Err(_) => {
                    failures = failures.saturating_add(1);
                    if failures >= 3 {
                        s.synced.store(false, Ordering::Release);
                        update_status(&s, "Status: Disconnected");
                        if sync_and_register(&app, s.clone()).await.is_ok() { failures = 0; }
                    }
                }
            }
        }
    });
}
fn show_main(app:&AppHandle)->Result<(),String>{let w=app.get_webview_window("main").ok_or("LiveSprite window unavailable")?;w.show().map_err(|e|e.to_string())?;let _=w.unminimize();w.set_focus().map_err(|e|e.to_string())}
fn spawn_sync(app:AppHandle){let s=app.state::<Arc<AppState>>().inner().clone();tauri::async_runtime::spawn(async move{if sync_and_register(&app,s.clone()).await.is_err(){s.synced.store(false,Ordering::Release);update_status(&s,"Status: Disconnected")}});}

fn main(){tauri::Builder::default()
    .plugin(tauri_plugin_single_instance::init(|app,_args,_cwd|{let _=show_main(app);}))
    .plugin(tauri_plugin_opener::init()).plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent,None))
    .plugin(tauri_plugin_global_shortcut::Builder::new().with_handler(|app,shortcut,event|dispatch(app,shortcut,event.state())).build())
    .invoke_handler(tauri::generate_handler![get_companion_status,activate_project_pairing,resync_hotkeys,set_hotkeys_paused,set_autostart,disconnect_companion,show_main_window,exit_application,list_microphones,start_voice_engine,stop_voice_engine,get_audio_status,test_hotkey_action,open_external])
    .on_window_event(|window,event|{if window.label()=="main"{if let WindowEvent::CloseRequested{api,..}=event{if window.state::<Arc<AppState>>().config().close_to_tray{api.prevent_close();let _=window.hide();}}}})
    .setup(|app|{let path=app.path().app_config_dir()?.join("companion.json");let mut c=load_config(&path);let auto=app.autolaunch().is_enabled().unwrap_or(c.start_with_os);c.start_with_os=auto;let _=save_config(&path,&c);
        let s=Arc::new(AppState{config:Mutex::new(c.clone()),config_path:path,bindings:Mutex::new(HashMap::new()),conflicts:Mutex::new(Vec::new()),registered_count:Mutex::new(0),paused:AtomicBool::new(false),syncing:AtomicBool::new(false),synced:AtomicBool::new(false),client:Client::builder().timeout(Duration::from_secs(8)).build()?,event_lock:tokio::sync::Mutex::new(()),status_item:Mutex::new(None),project_item:Mutex::new(None),voice_item:Mutex::new(None),pause_item:Mutex::new(None),autostart_item:Mutex::new(None),audio:AudioEngine::default()});app.manage(s.clone());
        let status=MenuItem::with_id(app,"status",if c.pair_token.is_empty(){"Status: Not paired"}else{"Status: Disconnected"},false,None::<&str>)?;let project=MenuItem::with_id(app,"project",if c.active_project_name.is_empty(){"Active Project: None".into()}else{format!("Active Project: {}",c.active_project_name)},false,None::<&str>)?;
        let voice=MenuItem::with_id(app,"voice","Voice Detection: Stopped",false,None::<&str>)?;let open=MenuItem::with_id(app,"open","Open LiveSprite",true,None::<&str>)?;let pause=MenuItem::with_id(app,"pause","Pause Hotkeys",true,None::<&str>)?;let resync=MenuItem::with_id(app,"resync","Re-sync Hotkeys",true,None::<&str>)?;let autostart=MenuItem::with_id(app,"autostart",if auto{"Disable autostart"}else{"Start with OS"},true,None::<&str>)?;let exit=MenuItem::with_id(app,"exit","Exit LiveSprite",true,None::<&str>)?;
        let menu=Menu::with_items(app,&[&status,&project,&voice,&open,&pause,&resync,&autostart,&exit])?;*s.status_item.lock().expect("status lock")=Some(status);*s.project_item.lock().expect("project lock")=Some(project);*s.voice_item.lock().expect("voice lock")=Some(voice);*s.pause_item.lock().expect("pause lock")=Some(pause);*s.autostart_item.lock().expect("autostart lock")=Some(autostart);
        TrayIconBuilder::with_id("main-tray").icon(app.default_window_icon().cloned().expect("icon missing")).tooltip("LiveSprite").menu(&menu).show_menu_on_left_click(false)
            .on_tray_icon_event(|tray,event|{if matches!(event,TrayIconEvent::DoubleClick{..}){let _=show_main(tray.app_handle());}})
            .on_menu_event(|app,event|match event.id().as_ref(){"open"=>{let _=show_main(app);},"resync"=>spawn_sync(app.clone()),"pause"=>{let s=app.state::<Arc<AppState>>().inner().clone();tauri::async_runtime::spawn(async move{let p=!s.paused.load(Ordering::Acquire);if set_paused(&s,p).await.is_err(){update_status(&s,"Status: Disconnected");}});},"autostart"=>{let s=app.state::<Arc<AppState>>().inner().clone();let on=!app.autolaunch().is_enabled().unwrap_or(false);if(if on{app.autolaunch().enable()}else{app.autolaunch().disable()}).is_ok(){if let Ok(mut c)=s.config.lock(){c.start_with_os=on;let _=save_config(&s.config_path,&c);}update_autostart(&s,on);}},"exit"=>app.exit(0),_=>{}}).build(app)?;
        start_heartbeat(app.handle().clone(),s);if !c.pair_token.is_empty(){spawn_sync(app.handle().clone())}let _=show_main(app.handle());Ok(())})
    .run(tauri::generate_context!()).expect("error while running LiveSprite")}

#[cfg(test)]mod tests{use super::*;fn b(key:&str,m:&[&str])->Binding{Binding{id:"id".into(),action_type:"expression".into(),action:"x".into(),target_id:"t".into(),target_name:"T".into(),key:key.into(),modifiers:m.iter().map(|v|v.to_string()).collect(),mode:"press".into(),enabled:true}}
#[test]fn accelerators(){assert_eq!(to_accelerator(&b("B",&["alt","ctrl","shift"])).unwrap(),"Control+Shift+Alt+KeyB");assert_eq!(to_accelerator(&b("1",&[])).unwrap(),"Digit1");assert_eq!(to_accelerator(&b("F24",&[])).unwrap(),"F24");assert_eq!(to_accelerator(&b("NumpadAdd",&["super"])).unwrap(),"Super+NumpadAdd")}}
