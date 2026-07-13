# 0005 Shared UI Platform Capabilities

## Status

Accepted

## Date

2026-07-13

## Context

DentLink needs consistent web and desktop presentation while also supporting platform-specific features: Tauri desktop actions, Android widgets, mobile intents, local files, terminal launching, mute controls, Voice FX, chimes, badges, and health reporting.

## Decision

Use shared React UI, design tokens, item model types, API client behavior, and sync behavior where practical. Place platform-specific actions behind typed capability layers implemented by web, Tauri desktop, Android, widgets, or trusted local agents.

## Consequences

- Web and desktop can stay visually and behaviorally consistent.
- Shared UI must not import Tauri, Android, shell, filesystem, or local-agent code.
- Platform adapters must clearly expose supported capabilities and failure modes.
- Desktop can preserve specialized workflows without becoming the backend controller.
- Android widgets may use native UI while still consuming normalized API/sync contracts.

## Alternatives considered

- Fully separate client implementations: rejected because it would duplicate business behavior and make ranking/sync consistency harder.
- One universal UI that directly calls all platform APIs: rejected because it would leak platform-specific behavior into shared packages.
- Desktop-first controller with web as a secondary view: rejected because the backend is the source of truth.
