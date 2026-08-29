import React, { useMemo, useState } from "react";
import { LiveSpriteAPI } from "../api/liveSpriteApi";
import { NativeCompanion } from "../native/companion";
import KeybindCapture from "../components/KeybindCapture";

const MODES = ["press", "toggle", "hold", "timed"];
const FIXED_ACTIONS = [
  { actionType: "avatar", action: "reset", targetName: "Reset to Normal" },
  { actionType: "avatar", action: "toggleVisibility", targetName: "Toggle Avatar Visibility" },
  { actionType: "avatar", action: "hide", targetName: "Hide Avatar" },
  { actionType: "avatar", action: "show", targetName: "Show Avatar" },
  { actionType: "voice", action: "toggleVoice", targetName: "Toggle Voice Detection" },
  { actionType: "voice", action: "toggleYelling", targetName: "Toggle Yelling Detection" },
];

function signature(binding) { return `${(binding.modifiers || []).join("+")}:${binding.key || ""}`; }

export default function HotkeysPage({ details, nativeStatus, reload, resync, setPaused, reportError }) {
  const [busy, setBusy] = useState("");
  const bindings = details?.hotkeys || [];
  const targets = useMemo(() => details ? [
    ...details.expressions.filter((item) => item.enabled !== false).map((expression) => ({ actionType: "expression", action: "activate", targetId: expression.id, targetName: expression.name, defaultMode: "toggle" })),
    ...FIXED_ACTIONS.map((action) => ({ ...action, defaultMode: "press" })),
  ] : [], [details]);
  const counts = bindings.filter((item) => item.enabled !== false && item.key).reduce((result, item) => ({ ...result, [signature(item)]: (result[signature(item)] || 0) + 1 }), {});
  const duplicates = Object.entries(counts).filter(([, count]) => count > 1).map(([key]) => key);
  const findBinding = (target) => bindings.find((item) => item.actionType === target.actionType && item.action === target.action && (item.targetId || "") === (target.targetId || ""));

  const persist = async (target, binding, patch) => {
    setBusy(binding?.id || `${target.actionType}:${target.targetId || target.action}`);
    try {
      if (binding) await LiveSpriteAPI.hotkeys.update(binding.id, patch);
      else await LiveSpriteAPI.hotkeys.create({ projectId: details.project.id, sortOrder: bindings.length, actionType: target.actionType, action: target.action, targetId: target.targetId || "", targetName: target.targetName, mode: target.defaultMode, returnBehavior: "previous", enabled: true, ...patch });
      await reload();
      if (nativeStatus?.activeProjectId === details.project.id) await resync();
    } catch (reason) { reportError(reason?.message || String(reason)); }
    finally { setBusy(""); }
  };
  const clear = async (binding) => {
    if (!binding) return;
    setBusy(binding.id);
    try { await LiveSpriteAPI.hotkeys.delete(binding.id); await reload(); if (nativeStatus?.activeProjectId === details.project.id) await resync(); }
    catch (reason) { reportError(reason?.message || String(reason)); }
    finally { setBusy(""); }
  };
  const test = async (binding) => {
    try { await NativeCompanion.testHotkey(binding.id, binding.mode); }
    catch (reason) { reportError(reason?.message || String(reason)); }
  };

  if (!details) return <section className="panel empty"><h2>Select a project</h2><p>Open a project before configuring global hotkeys.</p></section>;
  return <><header className="page-header"><div><h1>Global Hotkeys</h1><p>Capture shortcuts here; Rust registers them globally after every confirmed save.</p></div><span className={`status ${nativeStatus?.connected ? nativeStatus.paused ? "paused" : "online" : "offline"}`}><i />{nativeStatus?.connected ? `${nativeStatus.registeredCount} registered` : nativeStatus?.paired ? "Reconnecting" : "Not active"}</span></header>
    <section className="panel companion-strip"><div><small>Active project</small><strong>{nativeStatus?.activeProjectName || "No project paired"}</strong></div><div><small>Conflicts</small><strong>{nativeStatus?.conflicts?.length || 0}</strong></div><div className="actions"><button className="secondary compact" onClick={resync} disabled={!nativeStatus?.paired}>Re-sync</button><button className="primary compact" onClick={() => setPaused(!nativeStatus?.paused)} disabled={!nativeStatus?.paired}>{nativeStatus?.paused ? "Resume" : "Pause"}</button></div></section>
    <section className="panel hotkey-editor">{targets.map((target) => { const binding = findBinding(target); const duplicate = binding && duplicates.includes(signature(binding)); const nativeConflict = binding?.key && nativeStatus?.conflicts?.some((item) => item.toLowerCase().includes(binding.key.toLowerCase())); const state = !binding?.key || binding.enabled === false ? "Disabled" : duplicate || nativeConflict ? "Conflict" : nativeStatus?.connected && nativeStatus?.activeProjectId === details.project.id ? "Active" : "Saved"; const id = binding?.id || `${target.actionType}:${target.targetId || target.action}`; return <article className={`hotkey-card ${state === "Conflict" ? "invalid" : ""}`} key={id}><div className="hotkey-title"><strong>{target.targetName}</strong><small>{target.actionType === "expression" ? `Expression ID: ${target.targetId}` : `${target.actionType} · ${target.action}`}</small><span className={`status ${state === "Active" ? "online" : state === "Conflict" ? "paused" : "offline"}`}><i />{state}</span></div><KeybindCapture value={binding} duplicates={duplicates} onSave={(shortcut) => persist(target, binding, shortcut)} onClear={() => clear(binding)} /><div className="hotkey-options"><select value={binding?.mode || target.defaultMode} disabled={!binding || busy === id} onChange={(event) => persist(target, binding, { mode: event.target.value })}>{MODES.map((mode) => <option key={mode} value={mode}>{mode[0].toUpperCase() + mode.slice(1)}</option>)}</select>{binding && <button className="secondary compact" disabled={!nativeStatus?.paired || busy === id} onClick={() => test(binding)}>Test Action</button>}{binding && <button className="secondary compact" disabled={busy === id} onClick={() => persist(target, binding, { enabled: binding.enabled === false })}>{binding.enabled === false ? "Enable" : "Disable"}</button>}</div></article>; })}</section>
    {nativeStatus?.conflicts?.length > 0 && <section className="warning-panel"><strong>Native registration failures</strong>{nativeStatus.conflicts.map((item) => <span key={item}>{item}</span>)}</section>}
  </>;
}
