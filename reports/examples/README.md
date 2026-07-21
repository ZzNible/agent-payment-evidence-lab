# Example dossiers

This directory contains reviewed, publishable fixture dossiers for all six executable scenarios. It is not a source of production payment evidence.

The executable demo writes fresh output to `../generated/`:

```bash
npm run demo
npm run verify:examples
npm run verify:committed
```

Each scenario directory contains:

```text
verification-plan.json     predicates and trust profile committed for the run
evidence-bundle.json       observed artifacts, provenance, correlation, digests
verification-report.json   atomic PROVEN / NOT_PROVEN / UNKNOWN results
trace.json                 ordered local lifecycle observations
report.md                  human-readable projection of the JSON report
```

The committed examples are snapshots from one local run. Generated identifiers, timestamps, ephemeral payer addresses, and input digests can change between runs. The expected claim semantics should not. Integration assertions and schema verification detect unintended changes.

Before committing any future production-derived example:

1. remove payment headers, bearer tokens, private payloads, personal data, and credentials;
2. retain the declared source/controller and trust limitations;
3. state whether each artifact is fixture, testnet, or production-derived;
4. validate the plan, bundle, and report against the public schemas;
5. confirm that the report still contains `economicAction: "NOT_EVALUATED"`;
6. review the complete dossier, not only `report.md`.

The current lab uses a synthetic recording facilitator, an ephemeral in-memory EVM key, and no funds or external network. A successful local settlement-boundary observation is not evidence of production asset movement or on-chain finality.
