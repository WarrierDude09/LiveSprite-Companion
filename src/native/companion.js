import { invoke } from "@tauri-apps/api/core";

export const NativeCompanion = {
  getStatus: () => invoke("get_companion_status"),
  resync: () => invoke("resync_hotkeys"),
  setPaused: (paused) => invoke("set_hotkeys_paused", { paused }),
  setAutostart: (enabled) => invoke("set_autostart", { enabled }),
  setCloseToTray: (enabled) => invoke("set_close_to_tray", { enabled }),
  activateProject: ({ pairToken, projectId, projectName, gatewayUrl }) =>
    invoke("activate_project_pairing", {
      pairToken,
      projectId,
      projectName,
      gatewayUrl,
    }),
  disconnect: () => invoke("disconnect_companion"),
  showMainWindow: () => invoke("show_main_window"),
  exit: () => invoke("exit_application"),
  listMicrophones: () => invoke("list_microphones"),
  startVoiceEngine: (config) => invoke("start_voice_engine", { config }),
  stopVoiceEngine: () => invoke("stop_voice_engine"),
  getAudioStatus: () => invoke("get_audio_status"),
  testHotkey: (bindingId, mode) => invoke("test_hotkey_action", { bindingId, mode }),
  openExternal: (url) => invoke("open_external", { url }),
};
