# Agent Payment Evidence Lab

[![CI](https://github.com/miguel-herrero-systems/agent-payment-evidence-lab/actions/workflows/ci.yml/badge.svg)](https://github.com/miguel-herrero-systems/agent-payment-evidence-lab/actions/workflows/ci.yml)

Reproducible TypeScript experiments showing what AI-agent payment artifacts prove—and what they do **not** prove—about service delivery and obligation fulfilment, using x402 as the first executable rail.

The concrete seam is simple: an x402-protected request returns `202`, its local settlement boundary succeeds, and the deferred job later fails. Which evidence proves the payment boundary, which proves the later outcome, and which conclusion still cannot be drawn?

The lab runs six paid-request scenarios through the official x402 TypeScript client and Express middleware, creates signed fixture attestations about the resulting local observations, and evaluates small, explicit claims. It deliberately stops before the economic decision:

```json
{
  "economicAction": "NOT_EVALUATED"
}
```

This is an evidence-analysis laboratory. It is not an escrow, facilitator service, dispute resolver, payment monitor, or clearing oracle. It never releases, retains, refunds, or transfers funds.

> **Status:** research prototype v0.1 · local fixtures only · no production funds<br>
> **Maintainer:** [Miguel Herrero](https://github.com/miguel-herrero-systems) · independent research project<br>
> **Contact:** [contact@hrevn.com](mailto:contact@hrevn.com)

## Three separations the experiments make visible

```text
payment accepted != work completed
signed statement != independent, authoritative evidence
technical evaluation != authority to release or refund funds
```

## What this work led us to ask

| Executable observation | What the lab shows | Production question still open |
| --- | --- | --- |
| [`handler-500`](./reports/examples/handler-500/report.md) | The pinned middleware skips its local settlement boundary when the handler returns `>=400` | Which production path can settle and then fail: a `2xx/202` response, streaming, downstream work, or a different implementation? |
| [`accepted-then-async-failure`](./reports/examples/accepted-then-async-failure/report.md) | The local boundary succeeds before the deferred job reaches a failed terminal state | Which system is authoritative for that terminal state, who controls it, and what economic consequence follows? |
| [`self-attested-completion`](./reports/examples/self-attested-completion/report.md) | A provider-controlled key can authenticate its own completion statement without proving independence | How is decisive evidence acquired independently rather than merely supplied by an interested party? |
| [`independent-source-statement`](./reports/examples/independent-source-statement/report.md) | A separate precommitted key proves a signed statement, but not institutional independence or contractual authority | Who controls the source, and was it designated before execution as authoritative for this exact job and claim? |
| Every generated report | The analyzer always emits `economicAction: "NOT_EVALUATED"` | Which component converts a result into release or refund, can another party exercise an ordinary second veto, and what commitment binds the job, evidence, verdict, and settlement transition? |

These are operator and production questions, not claims that additional local fixtures can answer. See [Known unknowns](./KNOWN_UNKNOWNS.md) and [Claim semantics](./docs/claim-semantics.md) for the boundary in full.

## The question this repository tests

A successful payment interaction is not a single fact. It crosses several boundaries:

```text
precommitted plan
       │
       ▼
x402 request ──► handler response ──► later job/source state
       │                 │                       │
       └──────────── evidence bundle ────────────┘
                              │
                              ▼
                 atomic claim verification
                              │
                              ▼
          PROVEN / NOT_PROVEN / UNKNOWN
          economicAction = NOT_EVALUATED
```

The lab asks which narrow propositions follow from the captured artifacts. It does not turn those propositions into “work accepted,” “safe to pay,” or any other commercial verdict.

## Quick start

Requirements: Node.js `>=20.19.0` (CI uses Node.js 22) and npm.

The automated suite (`npm test`) covers the six scenarios, schema contracts, adversarial substitutions, signature/issuer bindings, the optional NEC on-chain verifier boundary, reproducibility, and CLI behavior; run it for the current test count rather than relying on a pinned number here.

```bash
npm ci
npm test
npm run demo
npm run verify:examples
npm run verify:committed
```

`npm run demo` starts a loopback-only Express server, executes all six scenarios, and writes the plan, evidence, derived report, human-readable projection, and diagnostic trace for each one under `reports/generated/`. No credentials, RPC endpoint, external service, or funded account is required.

To run every repository check:

```bash
npm run check
```

## Six executable seams

The current result counts are claim counts, not scores. They are included to make semantic drift visible; no scenario receives an aggregate pass/fail verdict.

| Scenario | Experimental seam | Expected narrow result | Current claim counts |
| --- | --- | --- | ---: |
| `valid-synchronous` | Successful local payment boundary plus schema-valid `200` response | Payment verification, local boundary, HTTP status, and schema claims are `PROVEN`; body binding, production transfer, and fulfilment remain `UNKNOWN` | 7 / 0 / 3 |
| `handler-500` | Protected handler returns `500` | Payment is verified, the pinned middleware skips the settlement boundary, and that boundary claim is `NOT_PROVEN` | 5 / 1 / 3 |
| `settled-invalid-schema` | Local settlement boundary succeeds for a `200` response with the wrong JSON shape | Payment-boundary facts are separate from output conformance; schema claim is `NOT_PROVEN` | 6 / 1 / 3 |
| `accepted-then-async-failure` | `202 Accepted`, followed by a terminal failed job | The synchronous boundary succeeds while terminal job success is `NOT_PROVEN` | 6 / 1 / 3 |
| `self-attested-completion` | A provider-controlled fixture identity signs `job_status=completed` | Signature and statement are `PROVEN`; independence is `NOT_PROVEN`; authority and fulfilment remain `UNKNOWN` | 8 / 1 / 4 |
| `independent-source-statement` | A separately identified lab source signs completion | Identity and statement are `PROVEN`; independence, authority, and fulfilment remain `UNKNOWN` | 8 / 0 / 5 |

Counts are shown as `PROVEN / NOT_PROVEN / UNKNOWN`.

The separately identified source in the sixth scenario has its own precommitted signing key, but the lab does not call it institutionally independent. A distinct identifier, controller declaration, or signature does not establish organizational control, neutrality, or contractual authority.

## Read the boundaries literally

| Layer | What the lab may establish | What does not follow automatically |
| --- | --- | --- |
| Payment | A precommitted local recording-double identity signed an artifact saying its configured boundary accepted or settled a payload | Production validity, transfer, confirmation, finality, or correct delivery |
| HTTP | The precommitted `lab-http-capture-adapter` key signed the harness's captured status, headers, body, and resource URL | Provider authorship, an authenticated remote channel, semantic correctness, or completion of deferred work |
| Schema | Observed JSON conforms to a precommitted structural contract | Truth, quality, usefulness, completeness, or fitness for purpose |
| Source | The key precommitted for the claim's named issuer signed a particular statement envelope | Independence, authority, or truth of that statement |
| Fulfilment | Only explicit machine-verifiable predicates can be assessed | The full commercial obligation, loss allocation, or a payment instruction |

Likewise, these propositions remain distinct:

```text
payment credential presented
  != payment verified
  != local settlement boundary succeeded
  != production asset movement
  != response body bound to payment
  != commercial obligation fulfilled
```

## What is real, and what is synthetic

The project pins `@x402/core`, `@x402/evm`, `@x402/express`, and `@x402/fetch` at exactly `2.19.0`.

The public evidence-bundle schema accepts only `protocol: "x402"` with `protocolVersion: "2.19.0"`; another declared version fails document validation rather than being interpreted using these semantics. This validates the bundle's label—it does not independently prove that imported evidence really came from that implementation.

It exercises the official x402 client and Express middleware control flow: the initial `402`, a locally signed EIP-3009 fixture authorization, verification, protected-handler execution, response buffering, settlement dispatch or verified-payment cancellation, and the final HTTP response. The recording double does not cryptographically or economically validate that authorization.

The payment boundary behind that middleware is a deterministic recording double:

- it accepts controlled fixture payments and records lifecycle calls;
- the client creates an ephemeral in-memory EVM key for each request;
- no private key is persisted;
- no funded account is used;
- no RPC endpoint, blockchain, or production facilitator is contacted;
- no assets move;
- a recorded successful settlement-boundary call is **not** production or on-chain evidence.

Payment-verification and settlement claims are additionally fail-closed to the fixture profiles encoded in their signed content: `mode: "local-recording-double"` plus `realNetworkVerification: false` or `realFundsMoved: false`. A differently shaped or production-looking artifact is not upgraded into proof. The payment resource URL inside the captured payment payload must equal the resource precommitted by the plan.

The HTTP response artifact is signed by `lab-http-capture-adapter`, and its public key is bound to that issuer by the precommitted trust context. This authenticates an attestation made by the local harness about what it captured. It does **not** authenticate the provider, a remote origin, DNS/TLS, or the network channel. Its captured `resourceUrl` must also match the plan's resource.

The asynchronous job artifact is similarly signed by `lab-job-state-adapter`. Authentication answers who signed the fixture artifact; authority to report the job predicate is a separate trust-profile input, and the job ID must match the ID in the signed HTTP capture.

These resource, interaction, and job-ID checks establish consistency among values inserted and signed inside one local harness. They do not yet prove independent end-to-end propagation across a payer, provider, facilitator, and outcome system. In v0.1, `authoritativeSources` is also a global issuer allowlist, not a claim-scoped grant of authority.

This asymmetry is intentional: the lab can reproduce middleware behavior without manufacturing economic evidence it does not possess. See [Protocol assumptions](./PROTOCOL_ASSUMPTIONS.md) for the complete trust boundary.

## The three-document evidence model

Every experiment keeps intent, observation, and analysis separate:

1. `verification-plan.json` (`apel.verification-plan/0.2`) precommits atomic claims plus the digest of the declared trust profile.
2. `evidence-bundle.json` (`apel.evidence-bundle/0.1`) records artifacts, provenance declarations, digests, and correlation data.
3. `verification-report.json` (`apel.verification-report/0.2`) derives claim results from the exact plan and bundle.

A generated scenario dossier contains:

```text
reports/generated/<scenario>/
├── verification-plan.json
├── evidence-bundle.json
├── verification-report.json
├── trace.json
└── report.md
```

`trace.json` is an uncommitted diagnostic view of the local runtime. It is not an evidence artifact, is not covered by the plan/bundle commitments, and must not be cited as authenticated proof. `npm run verify:examples` and `npm run verify:committed` require it to exist and parse as JSON as a dossier-shape check, but do not use its content to derive claims. They validate the public documents, recompute `verification-plan.json + evidence-bundle.json -> verification-report.json`, and compare the derived `report.md`; neither command authenticates or reconstructs the trace.

The report commits to the canonical SHA-256 digests of its exact plan and bundle. Decisive fixture observations are Ed25519-signed over their canonical artifact envelope, including identifier, kind, time, issuer declaration, content, and interaction correlation. The expected artifact identifier and issuer are named by the applicable plan claim, while the signing public key is bound to that issuer inside the trust context whose digest the plan precommits. Accepting a key embedded only in the artifact would authenticate no named party. These bindings detect substitution or later modification relative to the committed inputs; they do not prove that the original observation was true, independently acquired, or complete.

Source statements add a second interaction binding: the plan names `interactionField`, and the value at that signed content field must equal the plan's `interactionId`. The source-statement, source-authentication, independence, and authority claims remain separate even when they reference the same artifact.

Where a `RESPONSE_BODY_BOUND_TO_PAYMENT` claim is evaluated, the body commitment is the SHA-256 digest of the **canonicalized JSON value** under the lab's canonical-JSON rules. It is not a digest of raw HTTP entity bytes, content encoding, whitespace, transfer framing, or the bytes emitted by a particular serializer. A protocol that needs byte-for-byte binding must define and capture that different commitment explicitly.

All three public JSON documents are validated against the versioned schemas in [`schemas/`](./schemas/). The Markdown report is a human-readable projection of the JSON report, not a second decision engine. Reviewed fixture dossiers for all six scenarios are committed under [`reports/examples/`](./reports/examples/).

The public report schema enforces a closed `claim type ↔ status ↔ reasonCode` compatibility matrix. It rejects semantically impossible combinations even if each field is individually well formed; in particular, `OBLIGATION_FULFILLED / PROVEN` is not valid, and since report spec 0.2 `ONCHAIN_SETTLEMENT / PROVEN` is valid only with the single reason code `NEC_ONCHAIN_PAYMENT_EFFECT_FINALIZED` (see below).

`ONCHAIN_SETTLEMENT` remains deliberately `UNKNOWN` under the core verifier: no bundled JSON artifact that calls itself a transaction confirmation can produce `PROVEN`. A narrow exception exists for an explicitly registered external-consumer verifier (`NecOnchainClaimVerifier`) that consumes a frozen-profile [NEC](./docs/nec-phase-b-integration.md) network-evidence artifact and proves only that the plan-precommitted payment matches the observed on-chain effect of the exact transaction and that its containing L2 block is finalized under the pinned OP Stack ruleset. L2 finality is not withdrawal finalization, and none of this evaluates any economic action.

## CLI

```bash
# Run every scenario
npm run demo

# Run one scenario
npm run scenario -- accepted-then-async-failure --out reports/generated

# Analyze an existing plan and evidence bundle; emits JSON to stdout
npm run analyze -- \
  --plan reports/generated/valid-synchronous/verification-plan.json \
  --bundle reports/generated/valid-synchronous/evidence-bundle.json

# Validate and reproduce all generated dossiers from plan + bundle
npm run verify:examples

# Validate and reproduce the reviewed dossiers committed to the repository
npm run verify:committed

# Build the distributable CLI
npm run build
node dist/src/cli/index.js --help
```

CLI exit codes report technical execution errors only. `NOT_PROVEN` and `UNKNOWN` are evidence outcomes, not process failures and never payment instructions.

## Repository map

```text
schemas/                 public plan, bundle, and report contracts
src/domain/              protocol-independent evidence model
src/adapters/x402/       pinned x402 runner and recording boundary
src/verifiers/           atomic claim evaluation
src/reporters/           JSON and Markdown projections
src/scenarios/           six reproducible fixtures
tests/                   unit and integration checks for core invariants
docs/                    architecture, semantics, and extension rules
reports/generated/       locally regenerated dossiers
```

Start with:

- [Architecture](./docs/architecture.md)
- [Claim semantics](./docs/claim-semantics.md)
- [Threat model](./THREAT_MODEL.md)
- [Protocol assumptions](./PROTOCOL_ASSUMPTIONS.md)
- [Known unknowns](./KNOWN_UNKNOWNS.md)
- [Security policy](./SECURITY.md)
- [Contributing](./CONTRIBUTING.md)

## Extending the lab

The stable seam is `verification plan -> evidence bundle -> verification report`. New work should add an evidence adapter, an atomic verifier, and scenario tests without weakening the non-actuation invariant.

Plausible extensions include:

- observations from other x402 framework adapters or facilitator profiles;
- response-body or deferred-job bindings when a protocol actually commits them;
- read-only outcome-escrow state;
- a signed whole-bundle envelope and key-lifecycle rules (decisive fixture artifacts are already signed individually);
- zkTLS/TLS-notary provenance proofs;
- explicit authority and source-control profiles;
- a static evidence-graph explorer.

An extension must preserve `PROVEN / NOT_PROVEN / UNKNOWN`, claim-specific limitations, exact input commitments, and `economicAction: "NOT_EVALUATED"`. See the [extension model](./docs/extension-model.md).

## Known unknowns

The repository clarifies technical structure. It does not answer the empirical questions that would determine whether an independent evidence layer is needed:

- How often does payment succeed while paid-for asynchronous work later fails?
- Who bears a measurable loss, and do they care enough to change the workflow or pay?
- Is there an outcome source controlled by neither party?
- Would both parties designate that source as authoritative?
- If the source is authoritative, can the payment rail read it directly?
- Who would pay for acquisition, exception handling, liability, and support?

Those questions require operator interviews, production traces, and eventually real economic workflows. The full falsification criteria are maintained in [Known unknowns](./KNOWN_UNKNOWNS.md).

## Upstream references

- [x402 repository and protocol overview](https://github.com/x402-foundation/x402)
- [Official x402 documentation](https://docs.x402.org/introduction)
- [`@x402/express` middleware source at the inspected commit](https://github.com/x402-foundation/x402/blob/67b1ba0a7abbd7907a28fa624670872532e0eae9/typescript/packages/http/express/src/index.ts)
- [`@x402/express` middleware tests at the inspected commit](https://github.com/x402-foundation/x402/blob/67b1ba0a7abbd7907a28fa624670872532e0eae9/typescript/packages/http/express/src/index.test.ts)
- [Signed Offers & Receipts documentation](https://docs.x402.org/extensions/offer-receipt)
- [Offer & Receipt extension specification](https://github.com/x402-foundation/x402/blob/main/specs/extensions/extension-offer-and-receipt.md)

The signed receipt format currently documents `resourceUrl`, `payer`, `network`, `issuedAt`, and an optional `txHash`. The lab therefore does not treat a receipt alone as a commitment to response bytes, an output schema, a deferred job identifier, or the complete commercial obligation.

## License

[MIT](./LICENSE)
