# Desktop Handoff

Current desktop app:

- Tauri app lives in `apps/desktop`.
- Release binary: `apps/desktop/src-tauri/target/release/dentlink-desktop`.
- User autostart entry: `/home/evanrizzo/.config/autostart/dentlink-desktop.desktop`.
- Launch command:
  `setsid /home/evanrizzo/DentLink/apps/desktop/src-tauri/target/release/dentlink-desktop >/tmp/dentlink-desktop.log 2>&1 &`
- Expected window placement: `1920x720+2560-0`, fullscreen, bottom touchscreen display.
- Current deployed web preview: `https://868e35d4.dentlink-web-preview.pages.dev`.

Desktop behavior:

- Autostart launches the release binary on user session start.
- Desktop wrapper loads `https://dentlink-web-preview.pages.dev` with `dentlinkDesktop=1` and a cache-busting `desktopRevision`.
- Desktop session is stored independently from the browser via wrapper local storage.
- The right macro pad is icon-only, center-justified, and includes Assistant, Phone, Files, and Terminal.
- Assistant opens through a desktop postMessage action and no longer uses a floating web-pane Ask button.
- Desktop UI uses the dark DentLink logo and purple accent.

Recent desktop web UI state:

- Home uses a two-column priority inbox and upcoming timeline.
- Notifications cards are intended to match Home notification card typography and layout.
- Agenda cards use pin/check/x icon actions.
- Notes, Calendar, Settings, and context panels have desktop dark-mode overrides.
- Calendar day/week grid uses the same 64px/hour scale as event layout; event details have a sticky close header.

Validation commands used:

- `pnpm exec prettier --check apps/web/src/notes-app.tsx apps/web/src/styles.css`
- `pnpm --filter @dentlink/web typecheck`
- `pnpm --filter @dentlink/web build`
- `pnpm deploy:web:preview`
- `pnpm --filter @dentlink/desktop typecheck`
- `pnpm --filter @dentlink/desktop build`

Relaunch procedure:

1. Find visible PID: `xprop -name DentLink _NET_WM_PID WM_CLASS WM_NAME`
2. Kill exact PID: `kill <pid>`
3. Confirm closed: `xprop -name DentLink _NET_WM_PID`
4. Launch release binary with the launch command above.
5. Verify bounds: `xwininfo -name DentLink`.
