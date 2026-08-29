# LiveSprite Companion

LiveSprite Companion is a small Tauri 2 desktop tray app. It registers project hotkeys globally and forwards presses to the LiveSprite gateway. It does not render avatars or access a microphone.

## Pair and run

Launch the app, choose **Pair…** from the tray, and paste the per-project token from LiveSprite. The default gateway is already filled in. A successful pairing is stored as `companion.json` in the operating system's app config directory. Saved pairings sync automatically on future launches.

The tray provides re-sync, pause/resume, autostart, opening LiveSprite, and exit controls. The companion heartbeats every 10 seconds and re-syncs after three consecutive failures.

## Build locally

Prerequisites:

- Node.js 20 or newer and npm
- Stable Rust with a version supported by Tauri 2 (Rust 1.77.2 or newer)
- The [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS
- On Linux, WebKitGTK 4.1 and appindicator development packages

From this directory:

```sh
npm install
npm run tauri build
```

Bundles are written beneath `src-tauri/target/release/bundle/`. During development, use `npm run tauri dev`.

If the build reports that `cargo` is not found, install Rust through rustup. On Windows, also install Visual Studio 2022 Build Tools with **Desktop development with C++** and a Windows SDK; the Tauri CLI cannot produce an MSI without them.

## Release through GitHub Actions

This folder is intended to be the repository root. Create a GitHub repository, push this folder's contents, then tag a release:

```sh
git tag companion-v1.0.0
git push origin companion-v1.0.0
```

`.github/workflows/companion-release.yml` builds all three platforms and uploads these exact filenames to the GitHub release:

- `LiveSprite-Companion-Windows-x64.msi`
- `LiveSprite-Companion-macOS.dmg`
- `LiveSprite-Companion-Linux-x86_64.AppImage`

After the first successful release, update `base44/functions/GetCompanionRelease/entry.ts` in the separate web app: replace the placeholder `livesprite/companion` repository at line 20 with the real `owner/repo`.

Unsigned local macOS and Windows builds may show operating-system trust warnings. Production distribution normally requires platform signing credentials configured as GitHub Actions secrets.
