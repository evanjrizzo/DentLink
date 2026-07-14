# API App

Responsibility: Cloudflare Worker-style API and ingestion boundary.

This app owns the Milestone 1 auth and manual Notes API handler, request validation, server-side
session identity, user isolation, sync responses, note history, and conflict persistence. Session
storage keeps token hashes rather than raw bearer tokens. It must not execute arbitrary desktop
commands or accept client-supplied user IDs for authorization.

It does not implement connectors, calendar providers, webhooks, Tauri, Android, or AI calls.
