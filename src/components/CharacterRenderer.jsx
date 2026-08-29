import React, { useMemo, useState } from "react";

const APP_ORIGIN = "https://live-png-flow.base44.app";

export function resolveAssetUrl(value) {
  if (!value || typeof value !== "string") return "";
  try {
    const url = new URL(value, APP_ORIGIN);
    return url.protocol === "https:" || url.protocol === "data:" || url.protocol === "blob:" ? url.href : "";
  } catch {
    return "";
  }
}

export function safeAssetLabel(value) {
  try {
    const url = new URL(value, APP_ORIGIN);
    return `${url.host}${url.pathname}`;
  } catch {
    return "Invalid asset URL";
  }
}

export default function CharacterRenderer({ resolved, asset, alt = "LiveSprite character", visible = true, className = "", onStatus }) {
  const selectedAsset = asset || resolved?.asset;
  const assignment = resolved?.assignment;
  const source = useMemo(() => resolveAssetUrl(selectedAsset?.fileUrl), [selectedAsset?.fileUrl]);
  const [failure, setFailure] = useState("");
  const [attempt, setAttempt] = useState(0);

  const fail = (reason) => {
    setFailure(reason);
    onStatus?.({ ready: false, reason, assetId: selectedAsset?.id || null, url: safeAssetLabel(selectedAsset?.fileUrl) });
  };

  if (!selectedAsset) return <div className={`character-renderer-empty ${className}`}>No artwork is assigned to this state.</div>;
  if (!source) return <div className={`character-renderer-error ${className}`}><strong>Unable to load character artwork.</strong><span>Asset: {selectedAsset.displayName || selectedAsset.id}</span><span>Reason: Invalid or unsupported asset URL.</span></div>;
  if (failure) return <div className={`character-renderer-error ${className}`}><strong>Unable to load character artwork.</strong><span>Asset: {selectedAsset.displayName || selectedAsset.id}</span><span>Source: {safeAssetLabel(source)}</span><span>Reason: {failure}</span><button className="secondary compact" onClick={() => { setFailure(""); setAttempt((value) => value + 1); }}>Retry</button></div>;

  return <img
    key={`${source}:${attempt}`}
    className={className}
    src={source}
    alt={alt}
    style={{
      opacity: visible ? 1 : 0,
      transform: assignment ? `translate(${assignment.positionX || 0}px, ${assignment.positionY || 0}px) scale(${assignment.scale || 1}) rotate(${assignment.rotation || 0}deg)` : undefined,
    }}
    onLoad={(event) => onStatus?.({ ready: true, assetId: selectedAsset.id, width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight, url: safeAssetLabel(source) })}
    onError={() => fail("The desktop WebView could not fetch or decode this image.")}
  />;
}
