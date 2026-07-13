# 0001 Use TypeScript Monorepo

## Status

Accepted

## Date

2026-07-13

## Context

DentLink will have multiple clients, a backend, connectors, shared item models, API clients, sync logic, ranking types, UI components, design tokens, and optional AI abstractions. Divergent implementations would increase the risk of inconsistent ranking displays, sync behavior, and schema drift.

## Decision

Use a pnpm TypeScript monorepo for initial implementation. Shared packages will hold cross-platform contracts such as item model types, API client behavior, sync engine behavior, design tokens, reusable React UI, ranking result types, AI provider interfaces, and connector SDK contracts.

Application and platform-specific code will live in app or capability-layer packages rather than shared business packages.

## Consequences

- Shared contracts can be versioned and tested in one repository.
- Web and desktop can reuse React UI where practical.
- Android-specific native code will still need clear boundaries and generated or duplicated transport types only where unavoidable.
- Package boundaries must be enforced so shared packages do not import platform-specific code.
- The monorepo should not be used as a reason to scaffold unused complexity before milestones need it.

## Alternatives considered

- Separate repositories for each client and service: rejected initially because it would make early contract iteration and shared model enforcement harder.
- Backend-only repository with client code elsewhere: rejected because client sync and UI contracts are central to DentLink's consistency goals.
- Non-TypeScript shared model definitions only: rejected initially because web, backend, and desktop can benefit from executable shared TypeScript code.
