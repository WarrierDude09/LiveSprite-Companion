import React, { useMemo, useRef, useState } from "react";
import { LiveSpriteAPI } from "../api/liveSpriteApi";
import { resolveArtwork, validateCoreStates } from "../runtime/stateResolver";
import "../styles/expressions.css";

const BASE_STATES = [
  ["idle", "Idle", true], ["talking", "Talking", true], ["idleBlink", "Idle Blink", false],
  ["talkingBlink", "Talking Blink", false], ["yelling", "Yelling", false],
];

export default function Studio({ details, reload, reportError }) {
  const input = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [expressionName, setExpressionName] = useState("");
  const [activeExpression, setActiveExpression] = useState("");
  const [previewVoice, setPreviewVoice] = useState("idle");
  const [blinking, setBlinking] = useState(false);
  const project = details?.project;
  const health = validateCoreStates(details?.states);
  const preview = useMemo(() => details ? resolveArtwork({ expressionId: activeExpression, voiceState: previewVoice, blinking, assignments: details.states, assets: details.assets }) : null,
    [details, activeExpression, previewVoice, blinking]);

  if (!details) return <section className="panel empty"><h2>Select a project</h2><p>Open one of your LiveSprite projects before entering Studio.</p></section>;

  const upload = async (files) => {
    const pngs = Array.from(files).filter((file) => file.type === "image/png");
    if (!pngs.length) return reportError("Choose one or more PNG files.");
    setUploading(true);
    try { for (const file of pngs) await LiveSpriteAPI.assets.upload(project.id, file); await reload(); }
    catch (reason) { reportError(reason?.message || "PNG upload failed."); }
    finally { setUploading(false); }
  };
  const assignment = (stateType, expressionId = null) => details.states.find((state) => state.stateType === stateType && (state.expressionId || null) === expressionId);
  const assign = async (stateType, assetId, expressionId = null) => {
    const current = assignment(stateType, expressionId);
    if (!assetId) { if (current) await LiveSpriteAPI.states.delete(current.id); }
    else await LiveSpriteAPI.states.assign({ projectId: project.id, stateType, assetId, expressionId, existingId: current?.id });
    await reload();
  };
  const transform = async (stateType, key, value) => {
    const current = assignment(stateType);
    if (!current) return;
    await LiveSpriteAPI.states.update(current.id, { [key]: Number(value) });
    await reload();
  };
  const createExpression = async () => {
    const name = expressionName.trim(); if (!name) return;
    try { const expression = await LiveSpriteAPI.expressions.create(project.id, name, details.expressions.length); setExpressionName(""); setActiveExpression(expression.id); await reload(); }
    catch (reason) { reportError(reason?.message || "Unable to create expression."); }
  };
  const deleteExpression = async (id) => { await LiveSpriteAPI.expressions.delete(project.id, id); if (activeExpression === id) setActiveExpression(""); await reload(); };

  return <><header className="page-header"><div><h1>Studio</h1><p>{project.name} · Changes save directly to LiveSprite.</p></div><span className={`status ${health.idle && health.talking ? "online" : "paused"}`}><i />{health.idle && health.talking ? "Core states ready" : "Setup incomplete"}</span></header>
    <div className="studio-layout">
      <section className="panel studio-tools">
        <span className="eyebrow">PNG ARTWORK</span><h2>Upload your artwork</h2>
        <div className={`drop-zone ${dragging ? "dragging" : ""}`} onClick={() => input.current?.click()} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(e) => { e.preventDefault(); setDragging(false); upload(e.dataTransfer.files); }}>
          <input ref={input} hidden type="file" accept="image/png" multiple onChange={(e) => upload(e.target.files)} />
          <strong>{uploading ? "Uploading…" : "Drop PNG files here"}</strong><small>or browse files · originals are not modified</small>
        </div>
        <div className="asset-grid">{details.assets.map((asset) => <div className="asset-tile" key={asset.id}><img src={asset.fileUrl} alt={asset.displayName} /><strong>{asset.displayName}</strong><small>{asset.width}×{asset.height} · {asset.hasTransparency ? "Transparent" : "Opaque"}</small></div>)}</div>
      </section>
      <section className="panel preview-panel"><span className="eyebrow">SHARED STATE RESOLVER</span><div className="character-preview">{preview ? <img src={preview.asset.fileUrl} alt="Resolved character state" style={{ transform: `translate(${preview.assignment.positionX || 0}px, ${preview.assignment.positionY || 0}px) scale(${preview.assignment.scale || 1})` }} /> : <div className="empty-preview">Assign Idle and Talking PNGs</div>}</div>
        <div className="preview-controls">{["idle","talking","yelling"].map((voice) => <button key={voice} className={previewVoice === voice ? "primary compact" : "secondary compact"} onClick={() => setPreviewVoice(voice)}>{voice}</button>)}<button className={blinking ? "primary compact" : "secondary compact"} onClick={() => setBlinking(!blinking)}>Blink</button></div>
        <select value={activeExpression} onChange={(e) => setActiveExpression(e.target.value)}><option value="">Normal</option>{details.expressions.filter((item) => item.enabled !== false).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      </section>
    </div>
    <section className="panel"><span className="eyebrow">CORE PNG STATES</span><div className="state-grid">{BASE_STATES.map(([type,label,required]) => { const current=assignment(type); return <article className="state-card" key={type}><div><strong>{label}</strong><small>{required ? "Required" : "Optional"}</small></div><select value={current?.assetId || ""} onChange={(e)=>assign(type,e.target.value)}><option value="">Not assigned</option>{details.assets.map((asset)=><option key={asset.id} value={asset.id}>{asset.displayName}</option>)}</select>{current&&<div className="transform-grid">{[["positionX","X",1],["positionY","Y",1],["scale","Scale",.05]].map(([key,label,step])=><label key={key}>{label}<input type="number" step={step} value={current[key] ?? (key==="scale"?1:0)} onChange={(e)=>transform(type,key,e.target.value)} /></label>)}</div>}</article>})}</div></section>
    <section className="panel"><span className="eyebrow">DYNAMIC EXPRESSIONS</span><div className="expression-create"><input value={expressionName} onChange={(e)=>setExpressionName(e.target.value)} placeholder="Expression name" /><button className="primary compact" onClick={createExpression}>Create Expression</button></div><div className="expression-list">{details.expressions.map((expression)=><article className="expression-card" key={expression.id}><div className="expression-heading"><div><strong>{expression.name}</strong><small>ID: {expression.id}</small></div><div><button className="secondary compact" onClick={async()=>{await LiveSpriteAPI.expressions.update(expression.id,{enabled:expression.enabled===false});await reload();}}>{expression.enabled===false?"Enable":"Disable"}</button><button className="danger compact" onClick={()=>deleteExpression(expression.id)}>Delete</button></div></div><div className="expression-states">{BASE_STATES.map(([type,label])=>{const current=assignment(type,expression.id);return <label key={type}><span>{label}</span><select value={current?.assetId||""} onChange={(e)=>assign(type,e.target.value,expression.id)}><option value="">Use fallback</option>{details.assets.map((asset)=><option key={asset.id} value={asset.id}>{asset.displayName}</option>)}</select></label>})}</div></article>)}</div></section>
  </>;
}
