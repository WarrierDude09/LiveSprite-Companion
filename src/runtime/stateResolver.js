const VALID_VOICE_STATES = new Set(["idle", "talking", "yelling"]);

export function resolveArtwork({ expressionId = "", voiceState = "idle", blinking = false, assignments = [], assets = [] }) {
  const voice = VALID_VOICE_STATES.has(voiceState) ? voiceState : "idle";
  const blinkType = voice === "idle" ? "idleBlink" : voice === "talking" ? "talkingBlink" : null;
  const expression = expressionId || null;
  const candidates = [];

  if (expression) {
    if (blinking && blinkType) candidates.push([expression, blinkType]);
    if (voice === "yelling") {
      candidates.push([expression, "yelling"], [null, "yelling"], [expression, "talking"]);
    } else {
      candidates.push([expression, voice]);
    }
  }

  if (blinking && blinkType) candidates.push([null, blinkType]);
  candidates.push([null, voice]);
  if (voice === "yelling") candidates.push([null, "talking"]);
  candidates.push([null, "idle"]);

  for (const [candidateExpression, stateType] of candidates) {
    const assignment = assignments.find((state) =>
      (state.expressionId || null) === candidateExpression && state.stateType === stateType);
    if (!assignment) continue;
    const asset = assets.find((item) => item.id === assignment.assetId);
    if (asset) return { assignment, asset, stateType, expressionId: candidateExpression };
  }
  return null;
}

export function validateCoreStates(assignments = []) {
  const base = assignments.filter((state) => !state.expressionId);
  return {
    idle: base.some((state) => state.stateType === "idle"),
    talking: base.some((state) => state.stateType === "talking"),
  };
}
