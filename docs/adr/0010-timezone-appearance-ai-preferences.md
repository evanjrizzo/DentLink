# ADR 0010: Timezone, appearance, and AI preference ownership

Status: Accepted
Date: 2026-07-15

## Context

Timezone affects backend-owned date interpretation, while appearance is device-specific. AI
importance instructions and thresholds affect server-side scoring policy but must not replace core
system instructions.

## Decision

Timezone and AI importance preferences are account-level settings stored in `user_preferences`.
Appearance, density, local source colors, and animation preferences are local-device settings stored
in versioned browser local storage.

Custom AI instructions supplement the fixed structured-output prompt. The notification threshold is
applied after scoring and is not sent to the AI provider.

## Consequences

Date behavior can synchronize across devices without forcing visual preferences to synchronize.
Local appearance settings can evolve with safe defaults. AI customization remains bounded and
provider-neutral.
