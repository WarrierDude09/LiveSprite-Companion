# LiveSprite Desktop

LiveSprite Desktop is the native Tauri 2 client for the existing LiveSprite platform. It uses the same Base44 app, accounts, entities, functions, permissions, projects, and live-session records as the website. Rust adds global OS hotkeys, tray/background operation, autostart, reconnect, local Companion configuration, microphone voice detection, structured logs, and safe diagnostics.

Launching the installed application opens the main LiveSprite window. Closing it hides the window while the tray, heartbeat, and hotkeys continue running; **Exit LiveSprite** in the tray terminates the process. A second launch focuses the existing window.

## Authentication and project pairing

The bundled frontend uses the official Base44 SDK with LiveSprite app ID `6a91eb974450aba1bcc39dcd`. Passwords and service credentials are never stored by Rust. The SDK owns the user session, while `companion.json` retains the separate per-project Companion credential used only for `sync`, `heartbeat`, `event`, and `pause`.

After login, choose a real project and select **Activate Native Hotkeys**. The authenticated frontend invokes the existing `CompanionGateway` `pair` action; Rust validates the returned credential before saving it. Existing v1 `companion.json` files remain compatible and automatically reconnect.

The current website/backend feature inventory and desktop coverage are recorded in [`docs/FEATURE_INVENTORY.md`](docs/FEATURE_INVENTORY.md).

## Desktop runtime areas

- **Dashboard / Projects**: loads real `PNGTuberProject` records from Base44 and lets users create/update backend-backed projects.
- **Studio**: uploads real PNG files through Base44 storage, stores `PNGAsset` metadata, assigns `StateAssignment` rows, and previews using the shared state resolver.
- **Character Animations**: reads/writes `project.animationConfig` and plays idle/talking/yelling motion locally in the renderer. Animation frames do not call the backend.
- **LiveSprite Live**: starts/updates the real `LiveSession`, controls expression/visibility/voice state, and pushes native microphone voice changes into that session.
- **Audio**: captures microphone audio locally with `cpal`, applies RNNoise-backed suppression where supported, noise gate, smoothing, talking detection, and yelling detection. Raw audio is not sent to the backend.
- **Hotkeys**: uses Tauri 2 global shortcuts, registers backend-provided bindings, detects local/OS registration conflicts, and preserves hold-mode release semantics.
- **Streaming**: manages real `StreamingSource` records and validates renderer/link behavior through backend functions.
- **Diagnostics / Logs**: reports real renderer, asset, audio, backend, hotkey, live-session, and version status. Diagnostic export redacts sensitive-looking lines before writing.

## Build locally

Prerequisites:

- Node.js 20 or newer and npm
- Stable Rust supported by Tauri 2
- The [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS
- On Windows, Visual Studio 2022 Build Tools with **Desktop development with C++** and a Windows SDK
- On Linux, WebKitGTK 4.1 and appindicator development packages

From the repository root:

```sh
npm install
npm run tauri build
```

Vite builds the React frontend, then Tauri builds the native application. Bundles are written under `src-tauri/target/release/bundle/`. During development, use `npm run tauri dev`.

## Release through GitHub Actions

Push a release tag to `WarrierDude09/LiveSprite-Companion`:

```sh
git tag companion-v1.3.0
git push origin companion-v1.3.0
```

`.github/workflows/companion-release.yml` builds all platforms. Windows publishes the preferred branded installer plus the exact legacy MSI filename required by the existing download backend:

- `LiveSprite-Windows-x64-Setup.exe`
- `LiveSprite-Companion-Windows-x64.msi`
- `LiveSprite-Companion-macOS.dmg`
- `LiveSprite-Companion-Linux-x86_64.AppImage`

Ensure the separate web app's `base44/functions/GetCompanionRelease/entry.ts` uses `WarrierDude09/LiveSprite-Companion`. Unsigned Windows and macOS builds may show trust warnings; production distribution requires platform signing credentials.

## Verification status

The `companion-v1.3.0-rc.7` prerelease completed successfully on the GitHub-hosted Windows, macOS, and Linux runners. It produced both Windows installer formats, the macOS DMG, and the Linux AppImage.

Current local verification:

- `npm run build` succeeds.
- `cargo fmt --check` succeeds.
- `cargo test` and `cargo clippy` are blocked on this Windows host because the MSVC linker `link.exe` is not installed/available. Install Visual Studio 2022 Build Tools with **Desktop development with C++** to run native checks locally.

A true production release remains blocked until the backend contracts in [`docs/BACKEND_REQUIREMENTS.md`](docs/BACKEND_REQUIREMENTS.md), Google OAuth desktop handoff, signed updater metadata/signing keys, platform signing, fresh-machine installer checks, and an authenticated end-to-end project test are completed.


