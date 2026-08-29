import { base44 } from "./base44Client";

const DEFAULT_AUDIO = {
  noiseGateDb: -55,
  talkingThresholdDb: -38,
  yellingThresholdDb: -18,
  attackMs: 80,
  releaseMs: 220,
  inputDeviceId: "",
};

const DEFAULT_BLINK = {
  enabled: true,
  intervalMin: 2.5,
  intervalMax: 6,
  duration: 0.12,
  doubleBlinkChance: 0.12,
};

const DEFAULT_ANIMATION = {
  idleBreathing: { enabled: true, strength: 1, speed: 1 },
  talkingBounce: { enabled: true, strength: 1, speed: 1 },
  yellingShake: { enabled: true, strength: 1, speed: 1 },
};

export const LiveSpriteAPI = {
  auth: {
    isAuthenticated: () => base44.auth.isAuthenticated(),
    login: (email, password) => base44.auth.loginViaEmailPassword(email, password),
    me: () => base44.auth.me(),
    logout: () => base44.auth.logout(),
    register: (email, password) => base44.auth.register({ email, password }),
    verifyOtp: (email, otpCode) => base44.auth.verifyOtp({ email, otpCode }),
    resendOtp: (email) => base44.auth.resendOtp(email),
    requestPasswordReset: (email) => base44.auth.resetPasswordRequest(email),
    acceptOAuthToken: async (token) => {
      base44.auth.setToken(token, true);
      return base44.auth.me();
    },
  },
  account: {
    async current(userId) {
      const accounts = await base44.entities.Accounts.filter({ userId });
      return accounts[0] || null;
    },
  },
  projects: {
    list: () => base44.entities.PNGTuberProject.list("-updated_date"),
    get: (id) => base44.entities.PNGTuberProject.get(id),
    create: (name, description) =>
      base44.entities.PNGTuberProject.create({
        name: name.trim(),
        description: description.trim(),
        initialSetupCompleted: false,
        setupStep: 1,
        audioConfig: DEFAULT_AUDIO,
        blinkConfig: DEFAULT_BLINK,
        animationConfig: DEFAULT_ANIMATION,
        streamingConfig: {
          outputWidth: 1920,
          outputHeight: 1080,
          backgroundMode: "transparent",
        },
      }),
    update: (id, patch) => base44.entities.PNGTuberProject.update(id, patch),
  },
  async projectDetails(projectId) {
    const [project, assets, states, expressions, hotkeys, streams, sessions] =
      await Promise.all([
        base44.entities.PNGTuberProject.get(projectId),
        base44.entities.PNGAsset.filter({ projectId }),
        base44.entities.StateAssignment.filter({ projectId }),
        base44.entities.Expression.filter({ projectId }, "sortOrder"),
        base44.entities.HotkeyBinding.filter({ projectId }, "sortOrder"),
        base44.entities.StreamingSource.filter({ projectId }),
        base44.entities.LiveSession.filter({ projectId }),
      ]);
    return { project, assets, states, expressions, hotkeys, streams, sessions };
  },
  hotkeys: {
    subscribe: (callback) => base44.entities.HotkeyBinding.subscribe(callback),
  },
  companion: {
    async pair(projectId) {
      const response = await base44.functions.invoke("CompanionGateway", {
        action: "pair",
        projectId,
      });
      const result = response?.data ?? response;
      if (!result?.pairToken) throw new Error(result?.error || "Pairing was not authorized.");
      return result;
    },
  },
};
