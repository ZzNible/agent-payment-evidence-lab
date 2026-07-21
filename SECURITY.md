# Security Policy

## Current scope

Agent Payment Evidence Lab is a local research fixture. It does not custody funds, connect to a production facilitator, move assets, or provide a hardened service for untrusted evidence ingestion. Its client signs a local EIP-3009 fixture authorization with an ephemeral key, but the recording double does not cryptographically/economically verify it and no funded production transaction is submitted.

Its Ed25519 signatures authenticate precommitted **fixture identities** and canonical artifact envelopes. In particular, the HTTP and job adapters attest to what the local harness recorded; they do not authenticate a provider, remote origin, DNS/TLS channel, or independent acquisition path. `ONCHAIN_SETTLEMENT` is not implemented as chain verification and remains `UNKNOWN`.

Security-sensitive changes should be assessed against the invariants and implementation-status distinctions in [THREAT_MODEL.md](./THREAT_MODEL.md). In particular, do not treat schema validation as a substitute for pre-parse resource limits, or fixture documentation as automatic secret redaction.

## Reporting a vulnerability

Do not place credentials, private keys, personal data, exploit payloads, or other sensitive details in a public issue.

Once this repository is hosted, use the host's private vulnerability-reporting channel if the maintainer has enabled one. If no private channel is listed, open only a non-sensitive issue asking the maintainer to establish private contact; retain technical details until that channel exists.

For a useful report, include the affected version or commit, the violated security invariant, reproduction conditions, impact within this repository's stated scope, and a minimal remediation suggestion. Reports that assume the lab moves real funds should first account for the synthetic boundary documented in [PROTOCOL_ASSUMPTIONS.md](./PROTOCOL_ASSUMPTIONS.md).

## Supported version

Until a release policy exists, only the current default branch is maintained. Historical commits and locally modified forks are not covered by a security-support commitment.
