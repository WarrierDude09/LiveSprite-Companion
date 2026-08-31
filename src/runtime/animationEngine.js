const clamp = (value, min, max, fallback) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
};

function preset(config = {}, fallbackEnabled = false) {
  return {
    enabled: config.enabled ?? fallbackEnabled,
    strength: clamp(config.strength, 0, 3, 1),
    speed: clamp(config.speed, 0.1, 4, 1),
  };
}

export function animationRuntime(project, voiceState = "idle") {
  const config = project?.animationConfig || {};
  const idle = preset(config.idleBreathing, false);
  const talking = preset(config.talkingBounce, false);
  const yelling = preset(config.yellingShake, false);
  const classes = [];
  const style = {};

  if (idle.enabled && (voiceState === "idle" || config.idleBreathing?.whileTalking)) {
    classes.push("anim-idle-breathing");
    style["--idle-strength"] = idle.strength;
    style["--idle-duration"] = `${3 / idle.speed}s`;
  }
  if (talking.enabled && voiceState === "talking") {
    classes.push("anim-talking-bounce");
    style["--talk-strength"] = talking.strength;
    style["--talk-duration"] = `${0.42 / talking.speed}s`;
  }
  if (yelling.enabled && voiceState === "yelling") {
    classes.push("anim-yelling-shake");
    style["--yell-strength"] = yelling.strength;
    style["--yell-duration"] = `${0.12 / yelling.speed}s`;
  }

  return {
    className: classes.join(" "),
    style,
    active: classes.map((name) => name.replace("anim-", "").replaceAll("-", " ")),
    config: { idleBreathing: idle, talkingBounce: talking, yellingShake: yelling },
  };
}

export function updateAnimationPreset(project, key, patch) {
  return {
    ...(project?.animationConfig || {}),
    [key]: { ...((project?.animationConfig || {})[key] || {}), ...patch },
  };
}
