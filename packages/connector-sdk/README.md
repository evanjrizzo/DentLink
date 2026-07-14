# Connector SDK

Responsibility: connector manifest and normalization boundary contracts.

This package defines provider-neutral connector manifests, auth capability descriptions, settings
schema contracts, health metadata, and capability flags. It must not execute arbitrary third-party
connector code inside the primary Worker.

Milestone 3 includes generic email and generic calendar catalog entries so the API, storage, and
typed client can validate connector account plumbing before a real provider exists. Provider keys
such as Gmail, Google Calendar, Outlook, Microsoft Graph, and IMAP are intentionally absent until
their own milestones implement them through this framework.
