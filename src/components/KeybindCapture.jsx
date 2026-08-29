import React, { useEffect, useMemo, useState } from "react";

const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta"]);

function keyFromEvent(event) {
  if (event.code.startsWith("Key")) return event.code.slice(3);
  if (event.code.startsWith("Digit")) return event.code.slice(5);
  return event.code || event.key;
}

export function shortcutLabel(binding) {
  if (!binding?.key) return "Unassigned";
  const names = { ctrl: "Ctrl", shift: "Shift", alt: "Alt", super: navigator.platform?.includes("Mac") ? "Command" : "Super" };
  return [...(binding.modifiers || []).map((value) => names[value] || value), binding.key].join(" + ");
}

export default function KeybindCapture({ value, duplicates = [], onSave, onClear }) {
  const [capturing, setCapturing] = useState(false);
  const [draft, setDraft] = useState(null);
  const label = useMemo(() => shortcutLabel(draft || value), [draft, value]);
  const duplicate = duplicates.includes(`${(draft || value)?.modifiers?.join("+") || ""}:${(draft || value)?.key || ""}`);

  useEffect(() => {
    if (!capturing) return undefined;
    const capture = (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") { setCapturing(false); setDraft(null); return; }
      if (MODIFIER_KEYS.has(event.key)) return;
      const key = keyFromEvent(event);
      if (!key) return;
      setDraft({ key, modifiers: [event.ctrlKey && "ctrl", event.shiftKey && "shift", event.altKey && "alt", event.metaKey && "super"].filter(Boolean) });
      setCapturing(false);
    };
    window.addEventListener("keydown", capture, true);
    return () => window.removeEventListener("keydown", capture, true);
  }, [capturing]);

  return <div className="keybind-capture"><kbd>{capturing ? "Press your desired shortcut…" : label}</kbd><div className="actions"><button className="secondary compact" onClick={() => { setDraft(null); setCapturing(true); }}>{value?.key ? "Change" : "Set Keybind"}</button>{draft && <button className="primary compact" onClick={() => { onSave(draft); setDraft(null); }}>Accept</button>}{(draft || value?.key) && <button className="danger compact" onClick={() => { setDraft(null); setCapturing(false); onClear(); }}>Clear</button>}{capturing && <button className="secondary compact" onClick={() => { setCapturing(false); setDraft(null); }}>Cancel</button>}</div>{duplicate && <small className="conflict-text">This shortcut is assigned more than once in this project.</small>}</div>;
}
