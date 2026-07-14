# @dentlink/imap-client

Production IMAP client primitives for DentLink email ingestion.

This package was extracted from the Gmail IMAP Worker spike. It provides a narrow,
Worker-compatible IMAP surface for Gmail XOAUTH2 polling:

- TLS socket abstraction
- XOAUTH2 formatting
- IMAP command parsing
- rolling recent-window search
- bounded fetch helpers
- limited MIME parsing
- Gmail identifier extraction

It does not create DentLink notifications or persist connector state.
