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
  },
  account: {
    async current(userId) {
      const accounts = await base44.entities.Accounts.filter({ userId });
      return accounts[0] || null;
    },
    usernameExists: async (username) => (await base44.entities.Accounts.filter({ username })).length > 0,
    create: (user, username, authProvider = "local") => base44.entities.Accounts.create({
      userId: user.id,
      username,
      authProvider,
      accountStatus: "active",
      onboardingCompleted: true,
      lastLoginAt: new Date().toISOString(),
    }),
    touchLogin: (id) => base44.entities.Accounts.update(id, { lastLoginAt: new Date().toISOString() }),
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
  assets: {
    async upload(projectId, file, category = "character") {
      if (file.type !== "image/png") throw new Error(`${file.name} is not a PNG file.`);
      const metadata = await readImageMetadata(file);
      const { file_url: fileUrl } = await base44.integrations.Core.UploadFile({ file });
      return base44.entities.PNGAsset.create({
        projectId,
        displayName: file.name.replace(/\.[^.]+$/, ""),
        originalName: file.name,
        fileUrl,
        width: metadata.width,
        height: metadata.height,
        fileSize: file.size,
        format: file.type,
        hasTransparency: metadata.hasTransparency,
        category,
      });
    },
    delete: (id) => base44.entities.PNGAsset.delete(id),
  },
  states: {
    async assign({ projectId, stateType, assetId, expressionId = null, existingId = null }) {
      const data = { assetId };
      if (existingId) return base44.entities.StateAssignment.update(existingId, data);
      return base44.entities.StateAssignment.create({ projectId, stateType, assetId, ...(expressionId ? { expressionId } : {}) });
    },
    update: (id, patch) => base44.entities.StateAssignment.update(id, patch),
    delete: (id) => base44.entities.StateAssignment.delete(id),
  },
  expressions: {
    create: (projectId, name, sortOrder) => base44.entities.Expression.create({ projectId, name, sortOrder, enabled: true }),
    update: (id, patch) => base44.entities.Expression.update(id, patch),
    async delete(projectId, expressionId) {
      const [states, bindings] = await Promise.all([
        base44.entities.StateAssignment.filter({ projectId, expressionId }),
        base44.entities.HotkeyBinding.filter({ projectId }),
      ]);
      await Promise.all(states.map((state) => base44.entities.StateAssignment.delete(state.id)));
      await Promise.all(bindings.filter((binding) => binding.actionType === "expression" && binding.targetId === expressionId)
        .map((binding) => base44.entities.HotkeyBinding.delete(binding.id)));
      return base44.entities.Expression.delete(expressionId);
    },
    subscribe: (callback) => base44.entities.Expression.subscribe(callback),
  },
  sessions: {
    async start(projectId) {
      const sessions = await base44.entities.LiveSession.filter({ projectId });
      await Promise.all(sessions.filter((session) => session.active).map((session) => base44.entities.LiveSession.update(session.id, { active: false })));
      return base44.entities.LiveSession.create({
        projectId, active: true, currentBaseState: "idle", isTalking: false, isYelling: false,
        isBlinking: false, avatarVisible: true, voiceDetectionEnabled: true, yellingEnabled: true,
        currentExpressionId: "", currentExpressionName: "", previousExpressionId: "",
        activeAnimation: "", companionStates: {}, hotkeysPaused: false, micLabel: "",
      });
    },
    update: (id, patch) => base44.entities.LiveSession.update(id, patch),
    stop: (id) => base44.entities.LiveSession.update(id, { active: false }),
    subscribe: (callback) => base44.entities.LiveSession.subscribe(callback),
  },
  realtime: {
    subscribeProject(projectId, callback) {
      const entities = [base44.entities.PNGAsset, base44.entities.StateAssignment, base44.entities.Expression, base44.entities.HotkeyBinding, base44.entities.LiveSession];
      const stops = entities.map((entity) => entity.subscribe((event) => {
        if (event?.data?.projectId === projectId) callback(event);
      }));
      return () => stops.forEach((stop) => {
        if (typeof stop === "function") stop();
        else if (stop?.unsubscribe) stop.unsubscribe();
      });
    },
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

function readImageMetadata(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        context.drawImage(image, 0, 0);
        const alpha = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let hasTransparency = false;
        for (let index = 3; index < alpha.length; index += 4) {
          if (alpha[index] < 255) { hasTransparency = true; break; }
        }
        resolve({ width: image.naturalWidth, height: image.naturalHeight, hasTransparency });
      } catch {
        resolve({ width: image.naturalWidth, height: image.naturalHeight, hasTransparency: false });
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    };
    image.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error(`Unable to read ${file.name}.`)); };
    image.src = objectUrl;
  });
}
