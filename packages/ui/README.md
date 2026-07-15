# UI

Responsibility: shared presentation primitives and React components where practical.

This package consumes normalized DentLink models and design tokens. It includes the Milestone 1 Notes
workspace component. It must not import Tauri, Android, local-agent, shell, filesystem, provider raw
payload, or backend-only code.

Current Notes surfaces follow the web app adaptive-panel contract. The primary Notes page opens to
the list; create and edit/details use adaptive bottom-sheet or side-panel containers supplied by the
app CSS. Close controls are compact icon-style buttons with accessible labels. Advanced note fields
remain behind More Options so the shared component stays usable on mobile, the 1280x720 dashboard,
and desktop without provider-specific behavior leaking into the package.
