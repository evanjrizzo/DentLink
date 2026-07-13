# API Client

Responsibility: typed client for DentLink's versioned HTTP API.

This package will centralize request shapes, response parsing, retry-safe conventions, error shapes,
and sync endpoint access for clients. It must not contain server authorization logic or secrets.

Milestone 0B contains only the package boundary and tooling smoke test.
