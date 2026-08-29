import { invoke } from "@tauri-apps/api/core";

export const NativeCompanion = {
  getStatus: () => invoke("get_companion_status"),
  resync: () => invoke("resync_hotkeys"),
  setPaused: (paused) => invoke("set_hotkeys_paused", { paused }),
  setAutostart: (enabled) => invoke("set_autostart", { enabled }),
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
};
