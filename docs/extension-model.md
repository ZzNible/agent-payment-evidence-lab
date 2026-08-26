# Extension Model

## Goal

The first release is intentionally bounded, but it is not a throwaway prototype. New protocols, evidence sources, verifiers, and renderers should fit around the stable plan/evidence/report model.

The extension rule is:

> Add a protocol adapter or atomic verifier; do not rewrite the evidentiary core and do not add payment actuation.

## Stable core

Extensions should preserve:

- versioned verification plans;
- versioned evidence bundles;
- versioned verification reports;
- exact input digests;
- canonical-envelope digests and signatures for decisive observations, with issuer-to-key bindings committed before evaluation;
- atomic claim results: `PROVEN`, `NOT_PROVEN`, or `UNKNOWN`;
- explicit per-claim artifact/issuer selection, controller declarations, correlation, authority, and limitation data;
- the public report schema's closed claim-type/status/reason-code compatibility matrix;
- `economicAction: "NOT_EVALUATED"`;
- no global commercial `PASS`/`FAIL`.

If an extension cannot express its result without weakening those invariants, it belongs in a separate project or requires a new major specification version.

## Extension points

### Evidence adapters

An evidence adapter translates a protocol- or source-specific observation into the common artifact model.

Conceptually:

```ts
interface EvidenceAdapter {
  readonly id: string;
  readonly version: string;
  collect(context: CollectionContext): Promise<EvidenceArtifact[]>;
}
```

An adapter is responsible for:

- preserving raw or minimally transformed evidence;
- declaring collection time and method;
- declaring issuer and controller information without overstating it;
- providing an authenticatable artifact envelope and a precommittable issuer identity when a semantic claim relies on provenance;
- emitting stable correlation data;
- recording relevant version/network details;
- minimizing and redacting secrets;
- distinguishing collection failure from a negative outcome.

An adapter signature authenticates the adapter identity that created the envelope. It must not be described as provider, remote-origin, TLS-channel, or independent-source authentication unless the acquisition mechanism separately proves that stronger proposition. The current `lab-http-capture-adapter` and `lab-job-state-adapter` are examples of harness attestations, not provider-origin proofs.

An adapter must not decide that funds should move.

### Claim verifiers

A verifier evaluates one or more explicit claim types against a validated bundle and trust context.

Conceptually:

```ts
interface ClaimVerifier {
  readonly claimTypes: readonly ClaimType[];
  verify(
    claim: Claim,
    bundle: EvidenceBundle,
    trust: TrustContext
  ): Promise<ClaimResult>;
}
```

A verifier must define:

- the proposition it evaluates;
- required and optional artifact kinds;
- the plan parameter that selects each expected issuer;
- the conditions for each status;
- reason codes;
- freshness, correlation, and algorithm rules;
- limitations that survive into the report;
- tests for missing, malformed, stale, replayed, and contradictory evidence.

### Reporters

A reporter renders the canonical verification report without changing its semantics. JSON is the machine contract; Markdown is a human-readable projection.

A reporter must not invent an aggregate grade or omit limitations needed to interpret a result.

### Trust profiles

A trust profile can declare assumptions such as:

- which source identities are recognized;
- which controller relationships are asserted;
- which sources are authoritative, ideally scoped by claim type, predicate, resource, and time;
- allowed algorithms and versions;
- freshness and replay windows;
- whether evidence is local, testnet, or production.

Trust profiles are policy inputs, not discoveries made by a signature verifier. A profile must be versioned and its exact digest committed in the plan. Any issuer-to-public-key binding used for authentication belongs inside that commitment.

Authority must remain separate from authentication. For example, a valid `lab-job-state-adapter` signature identifies the fixture signer, while an `authoritativeSources` entry supplies a separate policy premise that the job verifier consumes. In v0.1 that field is only a global issuer list; it does not encode claim-, predicate-, resource-, or time-scoped authority. A future extension should add that granularity before describing the premise as a scoped appointment.

## Extension checklist

Every extension should add or update:

1. a versioned artifact kind or claim type;
2. schemas for any new public structure;
3. explicit trust and source-control assumptions;
4. reason codes and limitations;
5. unit tests for all three statuses;
6. integration or golden scenarios;
7. replay, substitution, omission, and downgrade tests;
8. protocol/version documentation;
9. threat-model changes;
10. proof that generated reports retain `economicAction: "NOT_EVALUATED"`.

Any new result path must also extend the strict public compatibility matrix; adding a reason code to a generic enum is insufficient if its claim type and status are not explicitly compatible.

## Candidate extensions

### 1. Additional x402 observations

Add adapters for other x402 framework integrations or facilitators while keeping results implementation-specific.

Useful comparisons include:

- when settlement is attempted relative to handler execution;
- behavior on `4xx`, `5xx`, thrown errors, streams, and disconnects;
- which fields receipts sign;
- whether a response or deferred job is cryptographically bound to the payment;
- cancellation and settlement-failure observability.

Each adapter must pin its package/version and identify whether the facilitator is synthetic, testnet, or production.

The current x402 schema is intentionally exact, not semver-compatible: it accepts the declared label `2.19.0` only. Supporting another version requires an explicit schema/adapter update and lifecycle review rather than a permissive version label. A version label alone still does not authenticate which implementation produced imported evidence.

### 2. Read-only outcome-escrow adapter

A read-only adapter for a protocol with job state and evaluator attestations—such as an ERC-8183-style deployment—could collect:

- on-chain job state;
- evaluator identity and attestation;
- evidence hash commitments;
- block and transaction context.

It may support claims such as:

- `ONCHAIN_JOB_STATE_OBSERVED`;
- `EVALUATOR_ATTESTATION_SIGNATURE_VALID`;
- `EVIDENCE_HASH_MATCHES`.

It must not sign a transaction or invoke completion, rejection, release, or refund methods. On-chain presence does not by itself prove evaluator neutrality or factual correctness.

Until such a chain-specific verifier exists, the core v0.1 `ONCHAIN_SETTLEMENT` claim remains `UNKNOWN` even if a bundle supplies an alleged confirmation JSON object. The optional NEC external-consumer verifier (`NecOnchainClaimVerifier`, see [NEC Phase-B integration](./nec-phase-b-integration.md)) is exactly such an extension: it stays outside the core default set, consumes only frozen-profile evidence envelopes, and may prove only its narrow `D_narrow` proposition.

### 3. zkTLS or TLS-notary provenance adapter

A provenance adapter could verify that selected fields came from a TLS session with a declared origin without storing the full private response.

It may support claims about:

- proof validity;
- the declared TLS origin;
- revealed fields;
- transcript or interaction binding;
- freshness and nonce use.

It must not automatically conclude:

- that the origin is independent of buyer and provider;
- that the origin is contractually authoritative;
- that the origin's database reflects reality;
- that the commercial obligation was fulfilled;
- that payment should be released.

This extension addresses evidence acquisition and privacy. It does not, by itself, solve institutional authority or unit economics.

### 4. Signed whole-bundle envelopes

The current lab already signs decisive fixture artifacts and precommits their issuer-to-key bindings. Signing the evidence bundle **as a whole** could additionally improve bundle-level authenticity, integrity, and chain of custody. A robust extension would define:

- canonicalization;
- signature envelope and key identifier;
- key rotation and revocation;
- timestamp/freshness semantics;
- multi-signature or witness support;
- privacy and selective-disclosure rules.

It must preserve the distinction between “this principal signed the bundle” and “the contents are true and neutral.”

### 5. Authority and control evidence

A future trust registry or profile could record which party controls a source and which source the parties designated for a predicate.

This is a governance layer. It should expose provenance for its assertions, expiry, conflicts, and version history rather than presenting independence as a cryptographic fact.

### 6. Static report explorer

A local or static web viewer could make the evidence graph easier to inspect:

- plan → claim → artifact links;
- input digests;
- source/controller boundaries;
- reason codes and limitations;
- scenario comparisons.

The viewer should render canonical reports and never compute a new economic recommendation.

### 7. Testnet capture

Testnet may be useful when it adds a fact the synthetic facilitator cannot provide, such as transaction-format interoperability or confirmation handling.

It should not be added merely for visual realism. Testnet assets still do not validate production demand, production finality, loss rates, or willingness to delegate authority.

## Scaling the implementation

The initial single-package architecture is appropriate while the public schemas and claim semantics evolve together. Split packages only when there is a concrete independent consumer, for example:

- `@apel/spec` for schemas and domain types;
- `@apel/core` for validation and claim dispatch;
- protocol-specific adapter packages;
- a CLI and report viewer.

Premature package boundaries would increase versioning cost without adding evidentiary value.

## Versioning policy

Use three separate version dimensions:

1. **Application version** — implementation and CLI release;
2. **Artifact specification version** — public plan/bundle/report shape and semantics;
3. **Adapter/verifier version** — protocol-specific interpretation.

A breaking semantic change requires a new artifact specification version even if the JSON shape is unchanged. Old reports should remain identifiable and reproducible with their original context.

## What must remain outside the core

The following are intentionally separate systems:

- payment or escrow actuation;
- buyer/provider onboarding and contracting;
- appointment of an expert determiner;
- appeals and dispute resolution;
- liability allocation and insurance;
- source-independence due diligence;
- commercial pricing and fee collection.

A later product may integrate with some of those systems. The evidence lab should remain capable of explaining its result without owning them.

## Choosing the next extension

Expansion should follow evidence, not the amount of time left in a build estimate. A useful next module should answer a new, material question such as:

- Can a real operator provide the identifiers needed for end-to-end correlation?
- Does a real receipt omit a binding that causes an actual loss?
- Is there a genuinely external source for a paid-but-failed job?
- Can a provenance proof be verified without making the lab redundant?
- Does a rail expose a distinct settlement/exception integration point?

The project can become technically richer without becoming commercially validated. Those two forms of progress should remain separate in the roadmap.
