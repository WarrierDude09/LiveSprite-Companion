# Backend requirements discovered during Desktop migration

The deployed LiveSprite frontend and public Base44 SDK establish the existing data contracts. Desktop now consumes those contracts directly. Two requested security-sensitive features cannot be implemented solely in an untrusted desktop bundle without adding verified backend functions.

## Google OAuth desktop code exchange

Base44's built-in `loginWithProvider` callback places `access_token` directly in `from_url`. A custom-protocol callback containing that token is vulnerable to scheme interception and violates LiveSprite's rule that permanent session tokens never appear in deep links.

The backend must provide a desktop authorization-code broker:

1. Desktop creates a cryptographically random state and PKCE verifier/challenge.
2. System browser authenticates with the existing Base44/Google flow.
3. A backend callback validates the provider result, state, account status, and PKCE challenge.
4. Backend creates a single-use code with a maximum lifetime of roughly 60 seconds.
5. Browser opens `livesprite://auth/callback?code=...&state=...`.
6. Desktop posts code, state, and verifier to an authenticated exchange endpoint.
7. Backend atomically consumes the code and returns the user session over HTTPS.

Codes must be hashed at rest, single-use, account-bound, device-flow-bound, audited without secrets, and invalidated after exchange. The custom URL must never contain Base44 or Google access/refresh tokens.

## Native voice-to-session bridge

The native engine detects Idle/Talking/Yelling locally. The authenticated frontend currently writes transitions to the existing `LiveSession` entity. For guaranteed delivery while the WebView is suspended, add a narrowly scoped CompanionGateway action authorized by the existing project pair token, such as `voiceState`, accepting only `idle`, `talking`, or `yelling` and updating only the paired project's active Live Session.

No service-role credential belongs in Desktop.

## Signed desktop updater

Tauri refuses unsigned updates, so the updater cannot be enabled safely without release-owner key material. Production setup requires:

1. Generate a Tauri updater signing keypair outside this repository.
2. Store the private key and optional password as GitHub Actions secrets named `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
3. Add the public key to `plugins.updater.pubkey` in `tauri.conf.json`.
4. Generate signed update bundles and a complete `latest.json` for Windows, macOS, and Linux.
5. Test an installed version A updating to version B before enabling updater controls.

No unsigned or placeholder updater endpoint is bundled.
