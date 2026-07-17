# Desktop App

Responsibility: Tauri desktop shell for DentLink's shared web client.

The desktop app is a client only. It loads the same React UI and versioned API client used by the
browser app, points production builds at the preview API unless a future production origin is
configured, and must not poll providers directly or become an alternate controller.

Current scope:

- Tauri v2 shell with a main DentLink web pane and a permanently attached right-side macro pad.
- Borderless window locked to the smallest connected monitor at startup, matching the bottom
  touchscreen layout.
- The macro pad starts at the legacy 244px rail width and keeps touch-sized 64px controls.
- Development mode starts the desktop wrapper Vite app and embeds the preview DentLink web client.
- Build mode packages the desktop wrapper into a native Tauri binary.
- Supported macro actions are the current visible legacy defaults: Phone (`scrcpy`), Files,
  Terminal, plus contextual Mute/Unmute and Voice FX while a voice-call capture client is detected.
- Files, Terminal, Phone, Mute, and Voice FX run through Tauri desktop commands.
- No user-editable macro configuration, local-agent pairing, chimes, badges, or health reporting are
  implemented yet.

Commands:

```bash
pnpm --filter @dentlink/desktop dev
pnpm --filter @dentlink/desktop build
```

Linux development requires the system WebKitGTK/Tauri dependencies documented by Tauri.
