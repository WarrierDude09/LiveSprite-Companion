import React, { useCallback, useEffect, useMemo, useState } from "react";
import { LiveSpriteAPI } from "./api/liveSpriteApi";
import { NativeCompanion } from "./native/companion";

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
  const items = [["dashboard","Dashboard"],["projects","Projects"],["hotkeys","Hotkeys"],["live","Live"],["settings","Settings"]];
  return <aside className="sidebar"><div className="sidebar-brand"><span>✦</span> LiveSprite</div><nav>{items.map(([id,label]) => <button key={id} className={page === id ? "active" : ""} onClick={() => setPage(id)}>{label}</button>)}</nav><div className="account-chip"><div className="avatar">{(account?.username || user?.email || "L")[0].toUpperCase()}</div><div><strong>{account?.username || "LiveSprite user"}</strong><small>{user?.email}</small></div><button title="Log out" onClick={onLogout}>↪</button></div></aside>;
}

function Dashboard({ account, projects, selected, nativeStatus, setPage, onSelect }) {
  return <><header className="page-header"><div><h1>Welcome back{account?.username ? `, ${account.username}` : ""}</h1><p>Your LiveSprite characters and native Companion are ready.</p></div><StatusBadge status={nativeStatus} /></header><div className="metric-grid"><article><small>Characters</small><strong>{projects.length}</strong><span>Synced with LiveSprite</span></article><article><small>Native hotkeys</small><strong>{nativeStatus?.registeredCount ?? 0}</strong><span>{nativeStatus?.conflicts?.length ? `${nativeStatus.conflicts.length} conflicts` : "No conflicts"}</span></article><article><small>Active project</small><strong className="project-metric">{nativeStatus?.activeProjectName || "None"}</strong><span>{nativeStatus?.paired ? "Native pairing saved" : "Choose a project"}</span></article></div><section className="panel hero-panel"><div><span className="eyebrow">ACTIVE CHARACTER</span><h2>{selected?.name || "Choose a LiveSprite project"}</h2><p>{selected?.description || "Select a character to manage its studio data and native global hotkeys."}</p><div className="actions"><button className="primary compact" onClick={() => setPage("projects")}>{selected ? "Open Project" : "View Projects"}</button>{selected && <button className="secondary compact" onClick={() => onSelect(selected)}>Refresh</button>}</div></div><div className="spark-orbit">✦</div></section></>;
}

function Projects({ projects, selected, selectProject, refresh, createProject }) {
  const [creating, setCreating] = useState(false); const [name,setName]=useState(""); const [description,setDescription]=useState(""); const [busy,setBusy]=useState(false);
  const submit=async e=>{e.preventDefault();setBusy(true);try{const project=await createProject(name,description);setName("");setDescription("");setCreating(false);selectProject(project);}finally{setBusy(false)}};
  return <><header className="page-header"><div><h1>My Characters</h1><p>These are the same projects available on the LiveSprite website.</p></div><button className="primary compact" onClick={() => setCreating(!creating)}>+ Create Character</button></header>{creating && <form className="panel create-form" onSubmit={submit}><label>Name<input value={name} onChange={e=>setName(e.target.value)} required /></label><label>Description<input value={description} onChange={e=>setDescription(e.target.value)} /></label><button className="primary compact" disabled={busy}>{busy?"Creating…":"Create"}</button></form>}<div className="project-grid">{projects.map(project=><article key={project.id} className={`project-card ${selected?.id===project.id?"selected":""}`}><div className="project-art">✦</div><div><h2>{project.name}</h2><p>{project.description || "LiveSprite character"}</p><small>{project.initialSetupCompleted ? "Studio configured" : "Setup in progress"}</small></div><button className="secondary compact" onClick={()=>selectProject(project)}>Open</button></article>)}</div>{!projects.length && <section className="panel empty"><div className="brand-mark">✦</div><h2>No Projects Yet</h2><p>Create your first LiveSprite character. It will also appear on the website.</p><button className="primary compact" onClick={()=>setCreating(true)}>Create Project</button></section>}<button className="link refresh" onClick={refresh}>Refresh projects</button></>;
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

function Settings({ user, account, nativeStatus, setAutostart, disconnect }) {
  return <><header className="page-header"><div><h1>Settings</h1><p>Account data remains in LiveSprite; desktop preferences remain local.</p></div></header><div className="settings-stack"><section className="panel setting"><div><span className="eyebrow">ACCOUNT</span><h2>{account?.username||"LiveSprite account"}</h2><p>{user.email}</p></div></section><section className="panel setting"><div><span className="eyebrow">DESKTOP</span><h2>Start LiveSprite with Windows</h2><p>Launch the background Companion and restore your project pairing after sign-in.</p></div><button className={`toggle ${nativeStatus?.autostart?"on":""}`} onClick={()=>setAutostart(!nativeStatus?.autostart)} aria-label="Toggle autostart"><i /></button></section><section className="panel setting"><div><span className="eyebrow">NATIVE COMPANION</span><h2>{nativeStatus?.activeProjectName||"No active project"}</h2><p>{nativeStatus?.paired?`${nativeStatus.registeredCount} hotkeys · ${nativeStatus.connected?"Connected":"Reconnecting"}`:"Activate a project to enable native hotkeys."}</p></div>{nativeStatus?.paired&&<button className="danger compact" onClick={disconnect}>Disconnect</button>}</section><section className="panel setting"><div><span className="eyebrow">ABOUT</span><h2>LiveSprite Desktop</h2><p>Version {nativeStatus?.version||"1.1.0"}</p></div></section></div></>;
}

export default function App() {
  const [state,setState]=useState("starting"); const [authView,setAuthView]=useState("login"); const [user,setUser]=useState(null); const [account,setAccount]=useState(null); const [projects,setProjects]=useState([]); const [selected,setSelected]=useState(null); const [details,setDetails]=useState(null); const [nativeStatus,setNativeStatus]=useState(null); const [page,setPage]=useState("dashboard"); const [error,setError]=useState(""); const [activating,setActivating]=useState(false);
  const refreshNative=useCallback(async()=>{try{setNativeStatus(await NativeCompanion.getStatus())}catch{}},[]);
  const loadProjects=useCallback(async()=>{const list=await LiveSpriteAPI.projects.list();setProjects(list);setSelected(current=>current||list[0]||null);return list},[]);
  const restore=useCallback(async()=>{setState("starting");setError("");try{if(!await LiveSpriteAPI.auth.isAuthenticated()){setState("auth");return}const current=await LiveSpriteAPI.auth.me();setUser(current);const [profile]=await Promise.all([LiveSpriteAPI.account.current(current.id),loadProjects(),refreshNative()]);setAccount(profile);setState("ready")}catch(reason){const message=reason?.message||"Unable to connect to LiveSprite.";if(reason?.status===401){setState("auth");setAuthView("login")}else{setError(message);setState("offline")}},[loadProjects,refreshNative]);
  useEffect(()=>{restore()},[restore]);
  useEffect(()=>{const timer=setInterval(refreshNative,5000);return()=>clearInterval(timer)},[refreshNative]);
  useEffect(()=>{if(!selected){setDetails(null);return}let cancelled=false;LiveSpriteAPI.projectDetails(selected.id).then(value=>{if(!cancelled)setDetails(value)}).catch(reason=>setError(reason?.message||"Unable to load project."));return()=>{cancelled=true}},[selected]);
  const logout=async()=>{await LiveSpriteAPI.auth.logout();setUser(null);setAccount(null);setProjects([]);setDetails(null);setState("auth");setAuthView("login")};
  const createProject=async(name,description)=>{const created=await LiveSpriteAPI.projects.create(name,description);await loadProjects();return created};
  const saveProject=async patch=>{const updated=await LiveSpriteAPI.projects.update(selected.id,patch);setSelected(updated);setProjects(list=>list.map(project=>project.id===updated.id?updated:project));setDetails(current=>({...current,project:updated}))};
  const activate=async()=>{if(!selected)return;setActivating(true);setError("");try{const pairing=await LiveSpriteAPI.companion.pair(selected.id);await NativeCompanion.activateProject({pairToken:pairing.pairToken,projectId:selected.id,projectName:selected.name,gatewayUrl:GATEWAY_URL});await refreshNative()}catch(reason){setError(reason?.message||String(reason))}finally{setActivating(false)}};
  const setPaused=async paused=>{try{await NativeCompanion.setPaused(paused);await refreshNative()}catch(reason){setError(String(reason))}};
  const resync=async()=>{try{await NativeCompanion.resync();await refreshNative()}catch(reason){setError(String(reason))}};
  const setAutostart=async enabled=>{try{await NativeCompanion.setAutostart(enabled);await refreshNative()}catch(reason){setError(String(reason))}};
  const disconnect=async()=>{await NativeCompanion.disconnect();await refreshNative()};
  const content=useMemo(()=>{if(page==="dashboard")return <Dashboard account={account} projects={projects} selected={selected} nativeStatus={nativeStatus} setPage={setPage} onSelect={setSelected}/>;if(page==="projects")return <><Projects projects={projects} selected={selected} selectProject={project=>{setSelected(project)}} refresh={loadProjects} createProject={createProject}/>{selected&&<ProjectOverview details={details} saveProject={saveProject} activate={activate} activating={activating} nativeStatus={nativeStatus}/>}</>;if(page==="hotkeys")return <Hotkeys details={details} nativeStatus={nativeStatus} resync={resync} setPaused={setPaused}/>;if(page==="live")return <LivePage details={details}/>;return <Settings user={user} account={account} nativeStatus={nativeStatus} setAutostart={setAutostart} disconnect={disconnect}/>},[page,account,projects,selected,nativeStatus,details,activating]);
  if(state==="starting")return <Spinner/>;
  if(state==="offline")return <ErrorState title="LiveSprite is Offline" message={`${error} Your native Companion is still running in the background.`} onRetry={restore}/>;
  if(state==="auth"){if(authView==="register")return <Register onAuthenticated={restore} setAuthView={setAuthView}/>;if(authView==="forgot")return <ForgotPassword setAuthView={setAuthView}/>;return <Login onAuthenticated={restore} setAuthView={setAuthView}/>}
  return <div className="app-shell"><Sidebar page={page} setPage={setPage} user={user} account={account} onLogout={logout}/><main className="content">{error&&<div className="error-banner dismissible">{error}<button onClick={()=>setError("")}>×</button></div>}{content}</main></div>;
}
