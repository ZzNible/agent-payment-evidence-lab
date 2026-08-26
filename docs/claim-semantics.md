# Claim Semantics

## Why claims are atomic

“The job passed” is too ambiguous for an evidence system. It can mean that payment settled, a handler returned `200`, an output matched a schema, a source reported `completed`, or a commercial obligation was satisfied.

The laboratory replaces that overloaded verdict with atomic propositions. Each proposition is evaluated independently and carries its own evidence, reason code, limitations, and trust assumptions.

## Result statuses

Every claim has exactly one status.

### `PROVEN`

The validated evidence implies the proposition **within the declared plan and trust model**.

`PROVEN` is never an unqualified statement about the world. For example:

- `SETTLEMENT_BOUNDARY_SUCCEEDED = PROVEN` under the local fixture means the precommitted recording-double key signed an envelope whose constrained fixture content reports a successful boundary result and `realFundsMoved: false`;
- it does not mean real funds moved;
- `SOURCE_STATEMENT_OBSERVED = PROVEN` means a valid correlated artifact contains the expected statement attributed to the explicitly selected issuer; authentication is a separate claim;
- `SOURCE_AUTHENTICATED = PROVEN` means the key precommitted for that issuer validly signed the canonical artifact envelope;
- it does not mean the job actually completed.

### `NOT_PROVEN`

There is sufficient valid evidence to evaluate the specified predicate, and the predicate is not satisfied.

Examples:

- an observed response is available and does not match the precommitted JSON Schema;
- a supplied digest does not match the canonical artifact bytes;
- a handler status is observed and is not in the plan's allowed set.

`NOT_PROVEN` does not automatically mean:

- the opposite proposition has been proven;
- the provider acted fraudulently;
- the overall service failed;
- money should be refunded.

It is a result about one predicate.

### `UNKNOWN`

The proposition cannot be established or rejected from the valid evidence and trust rules available.

Common causes include:

- missing evidence;
- stale evidence;
- invalid or unsupported provenance;
- a correlation gap;
- an unavailable source;
- an unresolved authority or independence relationship;
- a receipt that lacks a response-body binding;
- a commercial concept broader than the declared machine-verifiable predicates.

`UNKNOWN` is not an error condition and is not a euphemism for `FAIL`. It is the correct result when the evidence boundary has been reached.

## Evaluation model

Conceptually, a claim result is a function of:

```text
claim result = verify(
  precommitted claim,
  validated evidence bundle,
  trust profile,
  verifier version
)
```

The same artifact can support different claims with different statuses. A signed status document can make `SOURCE_AUTHENTICATED` and `SOURCE_STATEMENT_OBSERVED` provable while leaving `SOURCE_INDEPENDENT` and `OBLIGATION_FULFILLED` unresolved.

In the current specification, artifact-consuming semantic claims select both an artifact and its expected issuer in the plan (`issuerId` or a role-specific issuer parameter). The verifier does not learn the trusted issuer from the artifact itself. Digest/correlation claims range over selected artifacts, while the commercial-obligation claim deliberately consumes no decisive artifact.

For signed fixture evidence, authentication requires all of the following:

1. the selected artifact's digest matches its canonical envelope;
2. its interaction correlation matches the plan;
3. the artifact issuer equals the issuer named by the claim;
4. the plan's trust-profile digest matches the bundle trust context;
5. that trust context binds the named issuer to the signature's public key;
6. the Ed25519 signature verifies over the canonical envelope.

The envelope includes the artifact identifier, kind, capture/expiry time, issuer declaration, content, and interaction correlation. Passing these checks authenticates the fixture key and bytes under the committed model; it does not authenticate an unstated real-world origin.

## Evidence failure versus negative evidence

The system distinguishes an invalid carrier from a valid negative observation.

- If the only response artifact has a broken digest, `OUTPUT_SCHEMA_VALID` is normally `UNKNOWN`: the response cannot be trusted enough to evaluate its schema.
- The separate `DIGEST_VALID` claim can be `NOT_PROVEN` because the mismatching canonical envelope is exactly what that claim evaluates.
- If the response artifact is valid and its body violates the schema, `OUTPUT_SCHEMA_VALID` is `NOT_PROVEN`.

This avoids turning evidence corruption or absence into an unsupported assertion about the underlying service.

## Absence is usually not proof

Not finding an artifact is different from proving that an event did not occur.

An absence claim is only eligible for `PROVEN` when the collection mechanism is demonstrably complete for the relevant scope and time window—for example, an authoritative append-only log with a defined query boundary. A best-effort search returning no result normally yields `UNKNOWN`.

## Identity, integrity, independence, and authority

These concepts must be evaluated separately:

| Concept | Question | Typical supporting evidence |
| --- | --- | --- |
| Identity | Which principal or adapter attested to the artifact envelope? | signature plus precommitted issuer-to-key binding, authenticated API channel, attested session |
| Integrity | Does the canonical envelope match its commitment? | digest, signature, authenticated transcript |
| Independence | Can either transacting party control or materially influence the source? | ownership/control evidence, architecture, governance, conflict policy |
| Authority | What precommitted policy premise permits relying on this source? | plan, contract, trust profile, ideally scoped to a predicate/resource/time window |

A valid signature can support identity only when its key is already bound to the declared issuer. A key embedded solely in the artifact proves only that the same embedded key signed it. Even a correctly bound signature does not imply independence or authority.

Different source identity also does not imply independence. A provider may operate several domains, services, keys, or legal entities.

The current v0.1 trust context is less granular than the ideal: `authoritativeSources` is a global issuer allowlist. It does not encode claim type, predicate, resource, or validity window. A verifier can consume that global premise, but a report must not describe it as claim-scoped contractual authority.

## Payment claim boundaries

The following propositions are intentionally distinct:

```text
payment credential presented
    ≠ payment verified
    ≠ settlement attempted
    ≠ settlement recorded successful
    ≠ production finality
    ≠ response body bound to payment
    ≠ obligation fulfilled
```

The synthetic facilitator can support only fixture-scoped lifecycle claims. It cannot support production transfer or finality claims.

The current payment-verification and settlement verifiers accept only their signed `local-recording-double` profiles, with `realNetworkVerification: false` or `realFundsMoved: false`. Payment verification also requires the payment payload's resource URL to equal the plan resource. A different profile yields `UNKNOWN`; a different resource yields `NOT_PROVEN`.

Because the local harness constructs and propagates the resource and interaction values, these checks prove consistency inside the signed fixture—not independent end-to-end correlation among production actors. The settlement artifact does not independently commit the resource or job.

Where an x402 receipt is available, the verifier may prove only properties actually covered by its signed payload. If no response digest or job identifier is signed, the receipt cannot prove those bindings.

## HTTP and output claim boundaries

Likewise:

```text
handler returned HTTP 200
    ≠ response matches schema
    ≠ response is semantically correct
    ≠ asynchronous work completed
    ≠ buyer's commercial objective was achieved
```

JSON Schema is valuable for machine-verifiable structure. It does not prove factual correctness, quality, absence of regressions, or fitness for purpose.

In v0.1, the HTTP artifact is signed by the key precommitted for `lab-http-capture-adapter`, and its `resourceUrl` must match the plan resource. This proves only that the local harness capture identity attested to that response object. It is not a provider signature and does not authenticate a remote HTTP origin, DNS/TLS channel, or capture path outside the harness.

`RESPONSE_BODY_BOUND_TO_PAYMENT` uses SHA-256 of the canonical JSON **value** of the captured body. It does not compare raw HTTP entity bytes, transfer framing, compression, encoding, or serializer whitespace. The claim also requires an authenticated successful settlement artifact containing that commitment; the current fixture receipt omits it, so the normal scenarios remain `UNKNOWN` on body binding.

## Deferred-job claims

For an asynchronous job, the initial HTTP response and later job state are separate artifacts. A useful plan should define:

- the job identifier and how it binds to the paid request;
- the authoritative source, if any;
- accepted terminal states;
- the observation window;
- freshness and replay rules;
- whether a later reversal is possible.

If the initial response is successful but the later authoritative state is `failed`, the lab may report both propositions without collapsing them:

- `HTTP_STATUS_MATCH = PROVEN` for the expected synchronous status;
- `JOB_TERMINAL_SUCCESS = NOT_PROVEN` when the authenticated, authoritative fixture source reports a terminal failure tied to that response.

It still emits no economic action.

The current asynchronous fixture uses a signed artifact from `lab-job-state-adapter`. The plan selects that issuer explicitly, its key is precommitted, and the job ID must equal the `jobId` in the separately authenticated HTTP capture. Its signature authenticates the lab adapter, not a production provider API. The `accepted-then-async-failure` trust context separately includes the adapter in its global `authoritativeSources` list, which the job verifier consumes; this is not a claim-scoped appointment, and authentication alone would leave the policy premise unresolved.

## Self-attestation example

Suppose a fixture key precommitted for a provider-controlled issuer signs:

```json
{
  "interaction_id": "interaction-42",
  "job_status": "completed"
}
```

The plan names `interactionField: "interaction_id"`, `field: "job_status"`, the expected value, the artifact ID, and the expected provider issuer. The signed interaction field must equal `plan.subject.interactionId`. With the precommitted issuer-to-key binding and a valid envelope signature, a report may contain:

| Claim | Status | Interpretation |
| --- | --- | --- |
| Source identity valid | `PROVEN` | the precommitted key for the claim's provider issuer signed the artifact envelope |
| Source statement observed | `PROVEN` | the signed, interaction-bound content contains the selected field/value; authentication is evaluated separately |
| Source independent | `NOT_PROVEN` | the artifact declares provider control |
| Obligation fulfilled | `UNKNOWN` | the provider's statement is not neutral proof of fulfilment |

The model preserves the useful statement without laundering it into neutral evidence.

## Separate-source example

If a distinct precommitted fixture identity signs the same status, identity and statement claims may again be `PROVEN`. Independence remains `UNKNOWN` until control is established, and authority remains `UNKNOWN` unless the plan designated the source.

Only when the plan, source-control evidence, correlation, and status semantics all support the relevant narrow predicate should a stronger result be considered.

## On-chain claim boundary

Under the default `CoreClaimVerifier`, `ONCHAIN_SETTLEMENT` always yields
`UNKNOWN` in v0.1. With no artifact it reports missing confirmation evidence;
with an alleged confirmation artifact it reports that chain verification is
not implemented. A signed or well-formed JSON assertion is not a chain
receipt, a confirmation-depth check, or a finality proof.

An optional external-consumer verifier, `NecOnchainClaimVerifier`, may prove a
deliberately narrow proposition (`D_narrow`) from a frozen-profile NEC
evidence envelope: the plan-precommitted payment matches the observed effect
of the exact executed transaction and its containing L2 block is finalized
under the pinned OP Stack ruleset. Even then:

- NEC verdicts keep their epistemic weight: `supported` continues evaluation,
  `contradicted` yields `NOT_PROVEN`, and `insufficient`, `ambiguous`, or an
  unevaluable dimension yields `UNKNOWN`. A bounded outcome such as
  `OP_ANCESTRY_DEPTH_EXCEEDED` means the frozen resolver could not establish
  the required ancestry; it never becomes a claim that the block is not
  finalized;
- unusable transfer-shaped evidence (for example `removed=true` logs or
  structurally malformed words) yields `UNKNOWN`, never a negative assertion;
- L2 finality under one source's ruleset is not withdrawal finalization,
  L1 claimability, or economic irreversibility.

See [NEC Phase-B integration](./nec-phase-b-integration.md) for the full
mapping table and artifact boundary.

## Reason codes and limitations

Statuses are deliberately small; reason codes explain how a verifier arrived there. Illustrative codes include:

- `LOCAL_SETTLEMENT_BOUNDARY_SUCCEEDED`
- `SETTLEMENT_SKIPPED_AFTER_HANDLER_FAILURE`
- `JSON_SCHEMA_MATCH`
- `JSON_SCHEMA_MISMATCH`
- `PAYMENT_RECEIPT_HAS_NO_RESPONSE_BODY_BINDING`
- `SELECTED_ARTIFACT_NOT_FOUND`
- `INTERACTION_CORRELATION_MISMATCH`
- `SOURCE_STATEMENT_MATCHED`
- `ED25519_SIGNATURE_VALID`
- `SOURCE_INDEPENDENCE_NOT_ESTABLISHED`
- `SOURCE_AUTHORITY_NOT_ESTABLISHED`
- `ONCHAIN_VERIFICATION_NOT_IMPLEMENTED`
- `COMMERCIAL_OBLIGATION_NOT_EVALUATED`

A limitation should accompany any result whose wording could reasonably be overread. Limitations are part of the structured result, not optional prose.

The public report schema also constrains semantics structurally with a closed `type ↔ status ↔ reasonCode` matrix. An otherwise well-formed report is invalid if it combines incompatible values. In v0.1, `OBLIGATION_FULFILLED / PROVEN` can never validate; `ONCHAIN_SETTLEMENT / PROVEN` validates only with the single extension reason code `NEC_ONCHAIN_PAYMENT_EFFECT_FINALIZED`, and NEC-derived `insufficient`/`ambiguous` outcomes are compatible only with `UNKNOWN`, never `NOT_PROVEN`.

## No aggregate commercial verdict

The summary may count statuses for navigation, but it must not produce a score such as “4/5 passed,” “job accepted,” or “safe to pay.” Different claims have different meaning and importance; counting them does not produce contractual truth.

The only economic-action field is:

```json
{
  "economicAction": "NOT_EVALUATED"
}
```

A downstream system may define its own policy over reports, but that system is a separate decision-maker with separate authority, threat model, and liability.
