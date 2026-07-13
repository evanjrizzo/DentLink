# 0006 Optional Provider-Neutral AI

## Status

Accepted

## Date

2026-07-13

## Context

AI can help summarize content, estimate urgency, extract due dates, detect likely action requests, suggest task creation, and make bounded ranking adjustments. DentLink must not become unusable without one AI vendor, one model, or AI availability.

## Decision

Use an optional provider-neutral AI interface. OpenAI is the initial provider through one administrator-owned API key with per-user usage accounting designed into the system. Core ingestion, deterministic rules, ranking, notes, calendar, sync, and manual workflows must continue to work when AI is disabled.

## Consequences

- AI providers can be disabled or replaced without breaking core functionality.
- AI-created task suggestions initially require user approval.
- AI output must be bounded, explainable, and subordinate to deterministic and explicit user rules.
- Usage metadata must record provider, model, prompt or rule version, timestamp, confidence where available, source item, and usage details.
- Prompt injection and untrusted source content must be treated as security concerns.

## Alternatives considered

- AI-first ranking and ingestion: rejected because DentLink must remain functional without AI.
- OpenAI-specific domain model: rejected because it would make future provider replacement unnecessarily expensive.
- Autonomous AI actions such as dismissing, deleting, sending email, or editing provider events: rejected for the initial architecture because sensitive actions need explicit user approval.
