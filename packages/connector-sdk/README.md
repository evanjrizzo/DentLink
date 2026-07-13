# Connector SDK

Responsibility: connector manifest and normalization boundary contracts.

This package will define connector manifests, auth capability descriptions, settings schema
contracts, polling/webhook behavior contracts, health reporting, retry metadata, and supported
actions. It must not execute arbitrary third-party connector code inside the primary Worker.

Milestone 0B contains only the package boundary and tooling smoke test.
