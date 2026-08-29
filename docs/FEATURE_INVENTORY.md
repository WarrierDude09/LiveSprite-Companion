# LiveSprite website feature inventory

This inventory was derived from the production LiveSprite bundle and its real Base44 contracts. Absent features are not represented with mock data.

| Website feature | Actual backend source | Desktop status |
|---|---|---|
| Email/password login and session restore | Base44 Auth | Implemented |
| Registration and email OTP verification | Base44 Auth | Implemented |
| Password reset request | Base44 Auth | Implemented |
| Google login | Base44 Auth provider | Deferred until a secure desktop deep-link callback exists |
| Account/profile | `Accounts` | Read-only summary implemented |
| Project list/create/edit | `PNGTuberProject` | Implemented with real records |
| Studio assets | `PNGAsset` | Real inventory/count; full editor pending shared web source |
| Character states | `StateAssignment` | Real inventory/count; full editor pending |
| Expressions | `Expression` | Real inventory/count; full editor pending |
| Hotkey bindings | `HotkeyBinding` | Real list and native registration/status implemented |
| Streaming configuration | `StreamingSource` | Real current-state summary implemented |
| Live session state | `LiveSession` | Real current-state summary implemented |
| Native project authorization | `CompanionGateway` `pair` | Authenticated Base44 invocation implemented |
| Native sync/events/pause/heartbeat | `CompanionGateway` | Preserved in Rust |

Production routes observed include `/dashboard`, `/create`, `/studio/:id`, `/hotkeys/:id`, `/streaming/:id`, `/controller/:id`, `/live/:token`, and `/companion`. Full editor parity should reuse the website components if their source becomes available; this repository currently contains only the deployed bundle, so unverified product logic was intentionally not duplicated.
