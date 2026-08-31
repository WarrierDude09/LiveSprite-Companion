import React, { useMemo, useState } from "react";
import { LiveSpriteAPI } from "../api/liveSpriteApi";
import { animationRuntime, updateAnimationPreset } from "../runtime/animationEngine";
import { resolveArtwork } from "../runtime/stateResolver";
import CharacterRenderer from "../components/CharacterRenderer";
import "../styles/animations.css";

const PRESETS = [
  ["idleBreathing", "Idle Breathing", "Backend-managed idle motion used while the character is quiet.", "idle"],
  ["talkingBounce", "Talking Bounce", "Backend-managed motion layered while voice detection reports Talking.", "talking"],
  ["yellingShake", "Yelling Shake", "Backend-managed emphasis used when yelling detection is active.", "yelling"],
];

export default function AnimationSettings({ details, reload, reportError }) {
  const [saving, setSaving] = useState("");
  const [previewVoice, setPreviewVoice] = useState("idle");
  const project = details?.project;
  const runtime = useMemo(() => animationRuntime(project, previewVoice), [project, previewVoice]);
  const resolved = useMemo(() => details ? resolveArtwork({
    expressionId: "",
    voiceState: previewVoice,
    blinking: false,
    assignments: details.states,
    assets: details.assets,
  }) : null, [details, previewVoice]);

  if (!details) return <section className="panel empty"><h2>Select a project</h2><p>Open a LiveSprite project before configuring character animations.</p></section>;

  const savePreset = async (key, patch) => {
    setSaving(key);
    try {
      await LiveSpriteAPI.projects.update(project.id, { animationConfig: updateAnimationPreset(project, key, patch) });
      await reload();
    } catch (reason) {
      reportError(reason?.message || "Unable to save animation settings.");
    } finally {
      setSaving("");
    }
  };

  return <>
    <header className="page-header">
      <div>
        <h1>Character Animations</h1>
        <p>These settings are saved on the LiveSprite backend and played locally for low-latency motion.</p>
      </div>
      <span className="status online"><i />Backend-managed</span>
    </header>
    <div className="animation-layout">
      <section className="panel animation-preview">
        <span className="eyebrow">LOCAL ANIMATION ENGINE</span>
        <div className="character-preview">
          <CharacterRenderer resolved={resolved} animationClassName={runtime.className} animationStyle={runtime.style} alt="Animated character preview" />
        </div>
        <div className="preview-controls">
          {["idle", "talking", "yelling"].map((voice) => <button key={voice} className={previewVoice === voice ? "primary compact" : "secondary compact"} onClick={() => setPreviewVoice(voice)}>{voice}</button>)}
        </div>
        <div className="data-list">
          <div><span>Runtime state</span><strong>{previewVoice}</strong></div>
          <div><span>Active animation</span><strong>{runtime.active.length ? runtime.active.join(" + ") : "None"}</strong></div>
          <div><span>Render path</span><strong>Resolved PNG → CSS transform layer</strong></div>
        </div>
      </section>
      <section className="settings-stack">
        {PRESETS.map(([key, label, help, voice]) => {
          const value = runtime.config[key];
          const backend = project.animationConfig?.[key] || value;
          return <article className="panel animation-card" key={key}>
            <div className="animation-card-head">
              <div>
                <span className="eyebrow">BACKEND CONFIG</span>
                <h2>{label}</h2>
                <p>{help}</p>
              </div>
              <button className={`toggle ${backend.enabled ? "on" : ""}`} onClick={() => savePreset(key, { enabled: !backend.enabled })} disabled={saving === key} aria-label={`Toggle ${label}`}><i /></button>
            </div>
            <div className="animation-controls">
              <label>Strength<input type="range" min="0" max="3" step="0.05" value={value.strength} disabled={!backend.enabled || saving === key} onChange={(event) => savePreset(key, { strength: Number(event.target.value) })} /><span>{value.strength.toFixed(2)}×</span></label>
              <label>Speed<input type="range" min="0.1" max="4" step="0.05" value={value.speed} disabled={!backend.enabled || saving === key} onChange={(event) => savePreset(key, { speed: Number(event.target.value) })} /><span>{value.speed.toFixed(2)}×</span></label>
            </div>
            <div className="actions"><button className="secondary compact" onClick={() => setPreviewVoice(voice)}>Preview {label}</button><small>{saving === key ? "Saving…" : "Saved changes are backend-persistent."}</small></div>
          </article>;
        })}
      </section>
    </div>
  </>;
}
