# Contributing

Contributions should make evidence boundaries more precise, reproducible, or falsifiable without turning a technical report into a payment instruction.

## Before proposing a change

1. State the narrow claim the change evaluates.
2. Identify the exact artifact and trust assumption that support it.
3. Name the expected issuer in the claim and explain how its key/channel identity is precommitted; never trust an issuer or key solely because the artifact supplies it.
4. Describe what remains unproved, including capture origin, source control, authority, completeness, and production asset movement where relevant.
5. Add or update an executable scenario and tests when behavior changes.
6. Keep `economicAction` fixed at `NOT_EVALUATED`.

Run the repository checks before submitting work:

```bash
npm ci
npm run check
```

If generated example dossiers change intentionally, explain the semantic reason and review the JSON and Markdown outputs rather than committing them as an unexplained snapshot.

## Design constraints

- Preserve `PROVEN / NOT_PROVEN / UNKNOWN`; absence normally yields `UNKNOWN`.
- Never infer fulfilment from payment, settlement, HTTP status, schema validity, or a signature alone.
- Never infer independence from a distinct identifier, hostname, controller declaration, or signing key.
- Treat `lab-http-capture-adapter` and `lab-job-state-adapter` signatures as harness attestations, not provider, remote-origin, or authenticated-channel proof.
- Preserve payment/HTTP resource binding, source-statement interaction-field binding, and response-to-job-ID binding.
- Keep x402 interpretation fail-closed to the explicitly supported version; v0.1 supports exactly `2.19.0`.
- Keep payment and settlement claims constrained to the signed local recording-double profiles unless a separately specified production adapter is added.
- Keep `ONCHAIN_SETTLEMENT` at `UNKNOWN` until a chain-specific receipt/finality verifier exists.
- Preserve the public report schema's strict claim-type/status/reason-code matrix; it must continue to reject `OBLIGATION_FULFILLED / PROVEN` and `ONCHAIN_SETTLEMENT / PROVEN` in v0.1.
- Bind reports to the exact plan and evidence bundle they evaluated.
- Keep the recording facilitator visibly synthetic and offline.
- Document whether a mitigation is implemented now or merely required for a future hosted/production mode.

Review [docs/extension-model.md](./docs/extension-model.md), [docs/claim-semantics.md](./docs/claim-semantics.md), and [THREAT_MODEL.md](./THREAT_MODEL.md) before adding a verifier or adapter.
