import React, { useCallback, useEffect, useMemo, useState } from "react";
import { LiveSpriteAPI } from "./api/liveSpriteApi";
import { NativeCompanion } from "./native/companion";
import Studio from "./pages/Studio";
import LiveStudio from "./pages/LiveStudio";
import AnimationSettings from "./pages/AnimationSettings";
import CharacterRenderer, { resolveAssetUrl, safeAssetLabel } from "./components/CharacterRenderer";
import HotkeysPage from "./pages/HotkeysPage";
import StreamingSetup from "./pages/StreamingSetup";
import { resolveArtwork, validateCoreStates } from "./runtime/stateResolver";
import { listen } from "@tauri-apps/api/event";

const GATEWAY_URL = "https://live-png-flow.base44.app/functions/CompanionGateway";

function Spinner({ label = "Starting LiveSprite…" }) {
  return <main className="center-state"><div className="brand-mark">✦</div><h1>LiveSprite</h1><div className="spinner" /><p>{label}</p></main>;
}

function ErrorState({ title, message, onRetry }) {
  return <main className="center-state"><div className="brand-mark error">!</div><h1>{title}</h1><p>{message}</p>{onRetry && <button className="primary" onClick={onRetry}>Retry</button>}</main>;
}

function AuthShell({ children, title, subtitle, footer }) {
  return <main className="auth-page"><section className="auth-card"><div className="logo"><span>✦</span> LiveSprite</div><h1>{title}</h1><p>{subtitle}</p>{children}<div className="auth-footer">{footer}</div></section></main>;
}

function Login({ onAuthenticated, setAuthView }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event) => {
    event.preventDefault(); setBusy(true); setError("");
    try { await LiveSpriteAPI.auth.login(email, password); await onAuthenticated(); }
    catch (reason) { setError(reason?.message || "Incorrect email or password."); }
    finally { setBusy(false); }
  };
  return <AuthShell title="Welcome back" subtitle="Sign in to continue to your LiveSprite account" footer={<>Don't have an account? <button className="link" onClick={() => setAuthView("register")}>Create one</button></>}>
    <form onSubmit={submit} className="form-stack">
      {error && <div className="error-banner">{error}</div>}
      <label>Email<input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" required /></label>
      <label>Password<input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required /></label>
      <button type="button" className="forgot" onClick={() => setAuthView("forgot")}>Forgot password?</button>
      <button className="primary" disabled={busy}>{busy ? "Signing in…" : "Sign In"}</button>
    </form>
  </AuthShell>;
}

function Register({ onAuthenticated, setAuthView }) {
  const [stage, setStage] = useState("register");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const register = async (event) => {
    event.preventDefault(); setError("");
    if (password !== confirm) return setError("Passwords do not match.");
    setBusy(true);
    try { await LiveSpriteAPI.auth.register(email, password); setStage("verify"); }
    catch (reason) { setError(reason?.message || "Registration failed."); }
    finally { setBusy(false); }
  };
  const verify = async (event) => {
    event.preventDefault(); setBusy(true); setError("");
    try { await LiveSpriteAPI.auth.verifyOtp(email, otp); await onAuthenticated(); }
    catch (reason) { setError(reason?.message || "That verification code is invalid."); }
    finally { setBusy(false); }
  };
  if (stage === "verify") return <AuthShell title="Verify your email" subtitle={`We sent a verification code to ${email}`} footer={<button className="link" onClick={() => LiveSpriteAPI.auth.resendOtp(email)}>Resend code</button>}>
    <form onSubmit={verify} className="form-stack">{error && <div className="error-banner">{error}</div>}<label>Verification code<input value={otp} onChange={e => setOtp(e.target.value)} inputMode="numeric" required /></label><button className="primary" disabled={busy}>{busy ? "Verifying…" : "Verify Email"}</button></form>
  </AuthShell>;
  return <AuthShell title="Create your account" subtitle="Use the same LiveSprite account on web and desktop" footer={<>Already have an account? <button className="link" onClick={() => setAuthView("login")}>Log in</button></>}>
    <form onSubmit={register} className="form-stack">{error && <div className="error-banner">{error}</div>}<label>Email<input type="email" value={email} onChange={e => setEmail(e.target.value)} required /></label><label>Password<input type="password" value={password} onChange={e => setPassword(e.target.value)} minLength={8} required /></label><label>Confirm password<input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required /></label><button className="primary" disabled={busy}>{busy ? "Creating account…" : "Create Account"}</button></form>
  </AuthShell>;
}

function ForgotPassword({ setAuthView }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (event) => { event.preventDefault(); setBusy(true); try { await LiveSpriteAPI.auth.requestPasswordReset(email); } finally { setBusy(false); setSent(true); } };
  return <AuthShell title="Reset password" subtitle="We'll send you a secure reset link" footer={<button className="link" onClick={() => setAuthView("login")}>Back to login</button>}>
    {sent ? <div className="success-banner">If an account exists for {email}, a reset email is on its way.</div> : <form onSubmit={submit} className="form-stack"><label>Email<input type="email" value={email} onChange={e => setEmail(e.target.value)} required /></label><button className="primary" disabled={busy}>{busy ? "Sending…" : "Send Reset Link"}</button></form>}
  </AuthShell>;
}

function StatusBadge({ status }) {
  const tone = status?.connected ? (status.paused ? "paused" : "online") : "offline";
  const label = status?.connected ? (status.paused ? "Hotkeys paused" : "Connected") : status?.paired ? "Reconnecting…" : "Not paired";
  return <span className={`status ${tone}`}><i />{label}</span>;
}

function Sidebar({ page, setPage, user, account, onLogout }) {
  const items = [["dashboard","Dashboard"],["projects","Projects"],["studio","Studio"],["animations","Animations"],["hotkeys","Hotkeys"],["live","Live"],["streaming","Streaming"],["diagnostics","Diagnostics"],["settings","Settings"]];
  return <aside className="sidebar"><div className="sidebar-brand"><span>✦</span> LiveSprite</div><nav>{items.map(([id,label]) => <button key={id} className={page === id ? "active" : ""} onClick={() => setPage(id)}>{label}</button>)}</nav><div className="account-chip"><div className="avatar">{(account?.username || user?.email || "L")[0].toUpperCase()}</div><div><strong>{account?.username || "LiveSprite user"}</strong><small>{user?.email}</small></div><button title="Log out" onClick={onLogout}>↪</button></div></aside>;
}

function Dashboard({ account, projects, selected, nativeStatus, setPage, onSelect }) {
  return <><header className="page-header"><div><h1>Welcome back{account?.username ? `, ${account.username}` : ""}</h1><p>Your LiveSprite characters and native Companion are ready.</p></div><StatusBadge status={nativeStatus} /></header><div className="metric-grid"><article><small>Characters</small><strong>{projects.length}</strong><span>Synced with LiveSprite</span></article><article><small>Native hotkeys</small><strong>{nativeStatus?.registeredCount ?? 0}</strong><span>{nativeStatus?.conflicts?.length ? `${nativeStatus.conflicts.length} conflicts` : "No conflicts"}</span></article><article><small>Active project</small><strong className="project-metric">{nativeStatus?.activeProjectName || "None"}</strong><span>{nativeStatus?.paired ? "Native pairing saved" : "Choose a project"}</span></article></div><section className="panel hero-panel"><div><span className="eyebrow">ACTIVE CHARACTER</span><h2>{selected?.name || "Choose a LiveSprite project"}</h2><p>{selected?.description || "Select a character to manage its studio data and native global hotkeys."}</p><div className="actions"><button className="primary compact" onClick={() => setPage("projects")}>{selected ? "Open Project" : "View Projects"}</button>{selected && <button className="secondary compact" onClick={() => onSelect(selected)}>Refresh</button>}</div></div>{selected?.thumbnailUrl?<div className="dashboard-character"><CharacterRenderer asset={{id:`${selected.id}:thumbnail`,displayName:selected.name,fileUrl:selected.thumbnailUrl}} /></div>:<div className="spark-orbit">✦</div>}</section></>;
}

function Projects({ projects, selected, selectProject, refresh, createProject }) {
  const [creating, setCreating] = useState(false); const [name,setName]=useState(""); const [description,setDescription]=useState(""); const [busy,setBusy]=useState(false);
  const submit=async e=>{e.preventDefault();setBusy(true);try{const project=await createProject(name,description);setName("");setDescription("");setCreating(false);selectProject(project);}finally{setBusy(false)}};
  return <><header className="page-header"><div><h1>My Characters</h1><p>These are the same projects available on the LiveSprite website.</p></div><button className="primary compact" onClick={() => setCreating(!creating)}>+ Create Character</button></header>{creating && <form className="panel create-form" onSubmit={submit}><label>Name<input value={name} onChange={e=>setName(e.target.value)} required /></label><label>Description<input value={description} onChange={e=>setDescription(e.target.value)} /></label><button className="primary compact" disabled={busy}>{busy?"Creating…":"Create"}</button></form>}<div className="project-grid">{projects.map(project=><article key={project.id} className={`project-card ${selected?.id===project.id?"selected":""}`}>{project.thumbnailUrl?<div className="project-art"><CharacterRenderer asset={{id:`${project.id}:thumbnail`,displayName:project.name,fileUrl:project.thumbnailUrl}} /></div>:<div className="project-art">✦</div>}<div><h2>{project.name}</h2><p>{project.description || "LiveSprite character"}</p><small>{project.initialSetupCompleted ? "Studio configured" : "Setup in progress"}</small></div><button className="secondary compact" onClick={()=>selectProject(project)}>Open</button></article>)}</div>{!projects.length && <section className="panel empty"><div className="brand-mark">✦</div><h2>No Projects Yet</h2><p>Create your first LiveSprite character. It will also appear on the website.</p><button className="primary compact" onClick={()=>setCreating(true)}>Create Project</button></section>}<button className="link refresh" onClick={refresh}>Refresh projects</button></>;
}

function ProjectOverview({ details, saveProject, activate, activating, nativeStatus }) {
  const [name,setName]=useState(details?.project?.name||""); const [description,setDescription]=useState(details?.project?.description||"");
  useEffect(()=>{setName(details?.project?.name||"");setDescription(details?.project?.description||"")},[details?.project?.id]);
  if(!details) return <section className="panel empty"><p>Select a project first.</p></section>;
  return <div className="detail-grid"><section className="panel"><span className="eyebrow">PROJECT</span><h2>{details.project.name}</h2><div className="form-stack"><label>Name<input value={name} onChange={e=>setName(e.target.value)} /></label><label>Description<textarea value={description} onChange={e=>setDescription(e.target.value)} /></label><button className="primary compact" onClick={()=>saveProject({name,description})}>Save to LiveSprite</button></div></section><section className="panel"><span className="eyebrow">CONTENT</span><div className="data-list"><div><span>PNG assets</span><strong>{details.assets.length}</strong></div><div><span>Expressions</span><strong>{details.expressions.length}</strong></div><div><span>State assignments</span><strong>{details.states.length}</strong></div><div><span>Hotkey bindings</span><strong>{details.hotkeys.length}</strong></div></div></section><section className="panel companion-panel"><span className="eyebrow">NATIVE COMPANION</span><h2>{nativeStatus?.activeProjectId===details.project.id?"Active on this computer":"Activate this project"}</h2><p>Authorization is verified by CompanionGateway before Rust stores the project pairing credential.</p><button className="primary compact" onClick={activate} disabled={activating}>{activating?"Authorizing…":"Activate Native Hotkeys"}</button></section></div>;
}

function Hotkeys({ details, nativeStatus, resync, setPaused }) {
  return <><header className="page-header"><div><h1>Global Hotkeys</h1><p>Bindings are loaded from the same project data used by the website.</p></div><StatusBadge status={nativeStatus} /></header><section className="panel companion-strip"><div><small>Active project</small><strong>{nativeStatus?.activeProjectName||"No project paired"}</strong></div><div><small>Registered</small><strong>{nativeStatus?.registeredCount||0}</strong></div><div className="actions"><button className="secondary compact" onClick={resync}>Re-sync</button><button className="primary compact" onClick={()=>setPaused(!nativeStatus?.paused)} disabled={!nativeStatus?.paired}>{nativeStatus?.paused?"Resume":"Pause"}</button></div></section><section className="panel"><div className="table"><div className="table-head"><span>Action</span><span>Shortcut</span><span>Mode</span><span>Status</span></div>{details?.hotkeys?.map(binding=><div className="table-row" key={binding.id}><span>{binding.targetName||binding.action}</span><span><kbd>{[...(binding.modifiers||[]),binding.key].filter(Boolean).join(" + ")||"Unassigned"}</kbd></span><span>{binding.mode}</span><span>{binding.enabled!==false?"Enabled":"Disabled"}</span></div>)}{!details?.hotkeys?.length&&<div className="empty-row">Select a project with configured hotkeys.</div>}</div></section>{nativeStatus?.conflicts?.length>0&&<section className="warning-panel"><strong>{nativeStatus.conflicts.length} shortcut conflicts</strong>{nativeStatus.conflicts.map(item=><span key={item}>{item}</span>)}</section>}</>;
}

function LivePage({ details }) {
  const active=details?.sessions?.find(session=>session.active); const stream=details?.streams?.find(source=>source.active);
  return <><header className="page-header"><div><h1>Live</h1><p>Live session and streaming-source state from the LiveSprite backend.</p></div></header><div className="detail-grid"><section className="panel"><span className="eyebrow">LIVE SESSION</span><h2>{active?"Session active":"No active session"}</h2>{active&&<div className="data-list"><div><span>Base state</span><strong>{active.currentBaseState||"idle"}</strong></div><div><span>Expression</span><strong>{active.currentExpressionName||"Normal"}</strong></div><div><span>Avatar</span><strong>{active.avatarVisible===false?"Hidden":"Visible"}</strong></div></div>}</section><section className="panel"><span className="eyebrow">LIVESPRITE LINK</span><h2>{stream?"Streaming source ready":"Not configured"}</h2>{stream&&<p>{stream.outputWidth||1920} × {stream.outputHeight||1080} · {stream.backgroundMode||"transparent"}</p>}</section></div></>;
}

function Settings({ user, account, nativeStatus, setAutostart, setCloseToTray, disconnect }) {
  return <><header className="page-header"><div><h1>Settings</h1><p>Account data remains in LiveSprite; desktop preferences remain local.</p></div></header><div className="settings-stack"><section className="panel setting"><div><span className="eyebrow">ACCOUNT</span><h2>{account?.username||"LiveSprite account"}</h2><p>{user.email}</p></div></section><section className="panel setting"><div><span className="eyebrow">DESKTOP</span><h2>Start LiveSprite with Windows</h2><p>Launch the background Companion and restore your project pairing after sign-in.</p></div><button className={`toggle ${nativeStatus?.autostart?"on":""}`} onClick={()=>setAutostart(!nativeStatus?.autostart)} aria-label="Toggle autostart"><i /></button></section><section className="panel setting"><div><span className="eyebrow">DESKTOP</span><h2>Close LiveSprite to system tray</h2><p>Keep voice detection, global hotkeys, heartbeat, and realtime services running after closing the window.</p></div><button className={`toggle ${nativeStatus?.closeToTray?"on":""}`} onClick={()=>setCloseToTray(!nativeStatus?.closeToTray)} aria-label="Toggle close to tray"><i /></button></section><section className="panel setting"><div><span className="eyebrow">NATIVE COMPANION</span><h2>{nativeStatus?.activeProjectName||"No active project"}</h2><p>{nativeStatus?.paired?`${nativeStatus.registeredCount} hotkeys · ${nativeStatus.connected?"Connected":"Reconnecting"}`:"Activate a project to enable native hotkeys."}</p></div>{nativeStatus?.paired&&<button className="danger compact" onClick={disconnect}>Disconnect</button>}</section><section className="panel setting"><div><span className="eyebrow">ABOUT</span><h2>LiveSprite Desktop</h2><p>Version {nativeStatus?.version||"Unknown"}</p></div></section></div></>;
}

function ChooseUsername({ user, onComplete }) {
  const [username,setUsername]=useState("");const [busy,setBusy]=useState(false);const [error,setError]=useState("");
  const submit=async(event)=>{event.preventDefault();const value=username.trim();if(value.length<3)return setError("Use at least 3 characters.");if(!/^[a-zA-Z0-9_]+$/.test(value))return setError("Use only letters, numbers, and underscores.");setBusy(true);setError("");try{if(await LiveSpriteAPI.account.usernameExists(value))throw new Error("That username is already taken.");const provider=user.email?.toLowerCase().endsWith("@gmail.com")?"google":"local";await LiveSpriteAPI.account.create(user,value,provider);await onComplete();}catch(reason){setError(reason?.message||"Unable to create your LiveSprite account.")}finally{setBusy(false)}};
  return <AuthShell title="Choose your username" subtitle="This permanent LiveSprite account works on web and desktop" footer={user.email}><form className="form-stack" onSubmit={submit}>{error&&<div className="error-banner">{error}</div>}<label>Username<input value={username} onChange={(e)=>setUsername(e.target.value)} minLength={3} autoFocus required /></label><button className="primary" disabled={busy}>{busy?"Creating account…":"Continue to LiveSprite"}</button></form></AuthShell>;
}

function Diagnostics({ user, details, nativeStatus }) {
  const [audio,setAudio]=useState(null);
  const [imageCheck,setImageCheck]=useState({status:"Not tested",reason:""});
  const [copied,setCopied]=useState(false);
  const [exported,setExported]=useState("");
  const [logs,setLogs]=useState("");
  const [backendLatency,setBackendLatency]=useState("Not measured");
  const [perf,setPerf]=useState({fps:0,frameMs:0,heap:"Unavailable"});
  useEffect(()=>{const read=()=>NativeCompanion.getAudioStatus().then(setAudio).catch(()=>setAudio(null));read();const timer=setInterval(read,500);return()=>clearInterval(timer)},[]);
  useEffect(()=>{let frames=0;let last=performance.now();let frameStart=last;let raf=0;const tick=(time)=>{frames+=1;const frameMs=time-frameStart;frameStart=time;if(time-last>=1000){const memory=performance.memory?`${Math.round(performance.memory.usedJSHeapSize/1024/1024)} MB`:"Unavailable";setPerf({fps:Math.round(frames*1000/(time-last)),frameMs:Number(frameMs.toFixed(1)),heap:memory});frames=0;last=time}raf=requestAnimationFrame(tick)};raf=requestAnimationFrame(tick);return()=>cancelAnimationFrame(raf)},[]);
  useEffect(()=>{NativeCompanion.getLogs().then(setLogs).catch(()=>setLogs(""))},[]);
  const session=details?.sessions?.find((item)=>item.active);
  const core=validateCoreStates(details?.states);const resolved=details?resolveArtwork({expressionId:session?.currentExpressionId||"",voiceState:session?.currentBaseState||"idle",blinking:Boolean(session?.isBlinking),assignments:details.states,assets:details.assets}):null;
  useEffect(()=>{const source=resolveAssetUrl(resolved?.asset?.fileUrl);if(!source){setImageCheck({status:resolved?"Failed":"No resolved asset",reason:resolved?"Invalid asset URL":""});return}let active=true;const image=new Image();image.onload=()=>{if(active)setImageCheck({status:`Success · ${image.naturalWidth}×${image.naturalHeight}`,reason:""})};image.onerror=()=>{if(active)setImageCheck({status:"Failed",reason:"WebView fetch or image decode failed"})};image.src=source;return()=>{active=false}},[resolved?.asset?.id,resolved?.asset?.fileUrl]);
  const rows=[
    ["Backend project data",details?"Loaded":"No project loaded"],
    ["Authentication",user?.id?"Valid":"Unavailable"],
    ["Backend Latency",backendLatency],
    ["Project Sync",details?"Working":"Inactive"],
    ["Expressions in Database",details?String(details.expressions.length):"—"],
    ["Idle State",core.idle?"Found":"Missing"],
    ["Talking State",core.talking?"Found":"Missing"],
    ["Resolved PNG State",resolved?.stateType||"None"],
    ["Resolved Asset",resolved?.asset?.id||"None"],
    ["Asset URL",resolved?safeAssetLabel(resolved.asset.fileUrl):"Unavailable"],
    ["Asset Fetch / Decode",imageCheck.reason?`${imageCheck.status} · ${imageCheck.reason}`:imageCheck.status],
    ["Current Expression ID",session?.currentExpressionId||"Normal"],
    ["Microphone",audio?.running?`Connected · ${audio.deviceName}`:"Stopped"],
    ["Raw Audio Level",audio?.running?`${audio.rawLevelDb.toFixed(1)} dB`:"Inactive"],
    ["Noise Suppression",audio?.running?(audio.noiseSuppressionEnabled?`RNNoise · ${audio.suppressionStrength}`:"Disabled"):"Inactive"],
    ["Processed Audio Level",audio?.running?`${audio.processedLevelDb.toFixed(1)} dB`:"Inactive"],
    ["Voice State",audio?.running?audio.voiceState:"Inactive"],
    ["Renderer FPS",perf.fps?String(perf.fps):"Measuring…"],
    ["Frame Time",perf.frameMs?`${perf.frameMs} ms`:"Measuring…"],
    ["JS Heap",perf.heap],
    ["Global Hotkeys",nativeStatus?.connected?"Active":nativeStatus?.paired?"Reconnecting":"Not paired"],
    ["Registered Hotkeys",nativeStatus?`${nativeStatus.registeredCount}/${details?.hotkeys?.filter((item)=>item.enabled!==false).length||0}`:"—"],
    ["Live Session",session?"Active":"Stopped"],
    ["App Version",nativeStatus?.version||"Unknown"],
  ];
  const report=()=>rows.map(([label,value])=>`${label}: ${value}`).join("\n")+`\nHotkey conflicts: ${(nativeStatus?.conflicts||[]).join(" | ")||"None"}`;
  const copy=async()=>{try{await navigator.clipboard.writeText(report());await NativeCompanion.writeLog("INFO","Diagnostic report copied");setCopied(true);setTimeout(()=>setCopied(false),1800)}catch{setCopied(false)}};
  const measure=async()=>{setBackendLatency("Measuring…");try{setBackendLatency(`${await LiveSpriteAPI.diagnostics.backendLatency()} ms`);await NativeCompanion.writeLog("INFO","Backend latency measured")}catch(reason){setBackendLatency(reason?.message||"Failed")}};
  const refreshLogs=()=>NativeCompanion.getLogs().then(setLogs).catch(()=>setLogs(""));
  const exportReport=async()=>{try{const path=await NativeCompanion.exportDiagnosticReport(`${report()}\n\nLogs:\n${logs}`);setExported(path);await refreshLogs()}catch(reason){setExported(reason?.message||String(reason))}};
  return <><header className="page-header"><div><h1>Diagnostics</h1><p>Current native and backend state—no simulated health indicators.</p></div><div className="actions"><button className="secondary compact" onClick={measure}>Measure Backend</button><button className="secondary compact" onClick={copy}>{copied?"Copied!":"Copy Diagnostic Report"}</button></div></header><section className="panel"><div className="data-list">{rows.map(([label,value])=><div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>{nativeStatus?.conflicts?.length>0&&<div className="warning-panel"><strong>Hotkey conflicts</strong>{nativeStatus.conflicts.map((item)=><span key={item}>{item}</span>)}</div>}</section><section className="panel logs-panel"><div className="animation-card-head"><div><span className="eyebrow">STRUCTURED LOGS</span><h2>Local LiveSprite log</h2><p>Stored in the application config directory with sensitive values redacted before write/export.</p></div><div className="actions"><button className="secondary compact" onClick={refreshLogs}>Refresh</button><button className="secondary compact" onClick={async()=>{await NativeCompanion.clearLogs();await refreshLogs();}}>Clear</button><button className="secondary compact" onClick={exportReport}>Export</button><button className="secondary compact" onClick={()=>NativeCompanion.openLogFolder()}>Open Folder</button></div></div><pre className="log-viewer">{logs||"No log entries yet."}</pre>{exported&&<small className="runtime-note">Diagnostic export: {exported}</small>}</section></>;
}

export default function App() {
  const [state,setState]=useState("starting"); const [authView,setAuthView]=useState("login"); const [user,setUser]=useState(null); const [account,setAccount]=useState(null); const [projects,setProjects]=useState([]); const [selected,setSelected]=useState(null); const [details,setDetails]=useState(null); const [nativeStatus,setNativeStatus]=useState(null); const [page,setPage]=useState("dashboard"); const [error,setError]=useState(""); const [activating,setActivating]=useState(false);
  const refreshNative=useCallback(async()=>{try{setNativeStatus(await NativeCompanion.getStatus())}catch(reason){setError(reason?.message||String(reason)||"Unable to read native Companion status.")}},[]);
  const loadProjects=useCallback(async()=>{const list=await LiveSpriteAPI.projects.list();setProjects(list);setSelected(current=>current||list[0]||null);return list},[]);
  const reloadDetails=useCallback(async()=>{if(!selected){setDetails(null);return null}const value=await LiveSpriteAPI.projectDetails(selected.id);setDetails(value);return value},[selected]);
  const restore = useCallback(async () => {
    setState("starting");
    setError("");
    NativeCompanion.writeLog("INFO","LiveSprite session restore started").catch(()=>{});
    try {
      if (!await LiveSpriteAPI.auth.isAuthenticated()) {
        NativeCompanion.writeLog("INFO","No authenticated LiveSprite session found").catch(()=>{});
        setState("auth");
        return;
      }
      const current = await LiveSpriteAPI.auth.me();
      setUser(current);
      const [profile] = await Promise.all([
        LiveSpriteAPI.account.current(current.id),
        loadProjects(),
        refreshNative(),
      ]);
      if (!profile) { setState("onboarding"); return; }
      setAccount(profile);
      const status=(profile.accountStatus||"active").toLowerCase();
      if(status!=="active"){setState("blocked");return}
      NativeCompanion.writeLog("INFO","LiveSprite session restored for authenticated user").catch(()=>{});
      setState("ready");
    } catch (reason) {
      const message = reason?.message || "Unable to connect to LiveSprite.";
      NativeCompanion.writeLog("WARN",`LiveSprite restore failed: ${message}`).catch(()=>{});
      if (reason?.status === 401) {
        setState("auth");
        setAuthView("login");
      } else {
        setError(message);
        setState("offline");
      }
    }
  }, [loadProjects, refreshNative]);
  useEffect(()=>{restore()},[restore]);
  useEffect(()=>{let stop;listen("native-error",({payload})=>{const message=String(payload||"A native operation failed.");setError(message);NativeCompanion.writeLog("ERROR",message).catch(()=>{});}).then((unlisten)=>{stop=unlisten});return()=>{if(stop)stop()}},[]);
  useEffect(()=>{const timer=setInterval(refreshNative,5000);return()=>clearInterval(timer)},[refreshNative]);
  useEffect(()=>{let cancelled=false;if(!selected){setDetails(null);return}LiveSpriteAPI.projectDetails(selected.id).then(value=>{if(!cancelled)setDetails(value)}).catch(reason=>setError(reason?.message||"Unable to load project."));return()=>{cancelled=true}},[selected]);
  useEffect(()=>{if(!selected)return;let timer;const stop=LiveSpriteAPI.realtime.subscribeProject(selected.id,()=>{clearTimeout(timer);timer=setTimeout(reloadDetails,150)});return()=>{clearTimeout(timer);stop()}},[selected,reloadDetails]);
  const logout=async()=>{await LiveSpriteAPI.auth.logout();NativeCompanion.writeLog("INFO","LiveSprite account logged out").catch(()=>{});setUser(null);setAccount(null);setProjects([]);setDetails(null);setState("auth");setAuthView("login")};
  const createProject=async(name,description)=>{const created=await LiveSpriteAPI.projects.create(name,description);await loadProjects();return created};
  const saveProject=async patch=>{const updated=await LiveSpriteAPI.projects.update(selected.id,patch);setSelected(updated);setProjects(list=>list.map(project=>project.id===updated.id?updated:project));setDetails(current=>({...current,project:updated}))};
  const activate=async()=>{if(!selected)return;setActivating(true);setError("");try{const pairing=await LiveSpriteAPI.companion.pair(selected.id);await NativeCompanion.activateProject({pairToken:pairing.pairToken,projectId:selected.id,projectName:selected.name,gatewayUrl:GATEWAY_URL});await refreshNative()}catch(reason){setError(reason?.message||String(reason))}finally{setActivating(false)}};
  const setPaused=async paused=>{try{await NativeCompanion.setPaused(paused);await refreshNative()}catch(reason){setError(String(reason))}};
  const resync=async()=>{try{await NativeCompanion.resync();await refreshNative()}catch(reason){setError(String(reason))}};
  const setAutostart=async enabled=>{try{await NativeCompanion.setAutostart(enabled);await refreshNative()}catch(reason){setError(String(reason))}};
  const setCloseToTray=async enabled=>{try{await NativeCompanion.setCloseToTray(enabled);await refreshNative()}catch(reason){setError(String(reason))}};
  const disconnect=async()=>{await NativeCompanion.disconnect();await refreshNative()};
  const content=useMemo(()=>{if(page==="dashboard")return <Dashboard account={account} projects={projects} selected={selected} nativeStatus={nativeStatus} setPage={setPage} onSelect={setSelected}/>;if(page==="projects")return <><Projects projects={projects} selected={selected} selectProject={project=>{setSelected(project)}} refresh={loadProjects} createProject={createProject}/>{selected&&<ProjectOverview details={details} saveProject={saveProject} activate={activate} activating={activating} nativeStatus={nativeStatus}/>}</>;if(page==="studio")return <Studio details={details} reload={reloadDetails} reportError={setError}/>;if(page==="animations")return <AnimationSettings details={details} reload={reloadDetails} reportError={setError}/>;if(page==="hotkeys")return <HotkeysPage details={details} nativeStatus={nativeStatus} reload={reloadDetails} resync={resync} setPaused={setPaused} reportError={setError}/>;if(page==="live")return <LiveStudio details={details} reload={reloadDetails} reportError={setError}/>;if(page==="streaming")return <StreamingSetup details={details} reload={reloadDetails} reportError={setError}/>;if(page==="diagnostics")return <Diagnostics user={user} details={details} nativeStatus={nativeStatus}/>;return <Settings user={user} account={account} nativeStatus={nativeStatus} setAutostart={setAutostart} setCloseToTray={setCloseToTray} disconnect={disconnect}/>},[page,account,projects,selected,nativeStatus,details,activating,reloadDetails]);
  if(state==="starting")return <Spinner/>;
  if(state==="offline")return <ErrorState title="LiveSprite is Offline" message={`${error} Your native Companion is still running in the background.`} onRetry={restore}/>;
  if(state==="onboarding")return <ChooseUsername user={user} onComplete={restore}/>;
  if(state==="blocked")return <ErrorState title="Account unavailable" message={`Your LiveSprite account is ${account?.accountStatus||"not active"}. Contact a LiveSprite administrator for help.`}/>;
  if(state==="auth"){if(authView==="register")return <Register onAuthenticated={restore} setAuthView={setAuthView}/>;if(authView==="forgot")return <ForgotPassword setAuthView={setAuthView}/>;return <Login onAuthenticated={restore} setAuthView={setAuthView}/>}
  return <div className="app-shell"><Sidebar page={page} setPage={setPage} user={user} account={account} onLogout={logout}/><main className="content">{error&&<div className="error-banner dismissible">{error}<button onClick={()=>setError("")}>×</button></div>}{content}</main></div>;
}
