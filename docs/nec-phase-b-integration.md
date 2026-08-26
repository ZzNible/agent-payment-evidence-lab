# NEC Phase-B integration: external ONCHAIN_SETTLEMENT verification

Status: integration complete for `apel.verification-plan/0.2` +
`apel.verification-report/0.2`.

This document describes the Phase-B integration between this lab (APEL) and
the external [NEC (network evidence core)](https://github.com/ZzNible/network-evidence-core)
repository (which may be private; public accessibility is not assumed). It is
the single authoritative description of what the integration proves and —
equally important — what it does not.

**No runtime NEC dependency.** APEL has zero runtime or test-time dependency
on NEC packages: everything needed to evaluate this integration — fixtures,
manifests, tests, and the local structural parser — is self-contained in this
repository. The referenced NEC repository and its freeze tags are
provenance/reproducibility references only (they let an auditor holding a
frozen NEC checkout replay the committed raw captures); they are not a
runtime requirement and no code is fetched from them.

## Roles

- **NEC is an evidence producer.** Its frozen v0.1 packages
  (`@nec/core` `core-v0.1-freeze`, `@nec/resolver-evm` `evm-v0.1-freeze`,
  `@nec/adapter-x402` `x402-v0.1-freeze`, `@nec/resolver-opstack`
  `opstack-v0.1-freeze`; OP Stack freeze commit
  `9cd650d7f7491e59f02c31f6185e8ca61392a88e`) acquire raw JSON-RPC
  observations from ONE configured public Base mainnet source and emit
  frozen-profile evaluation artifacts. APEL imports no NEC code: it consumes
  only the artifact bytes at the stable wire/profile boundary.
- **APEL is the authority for its own settlement claim.**
  `NecOnchainClaimVerifier` (`src/verifiers/nec-onchain-claim-verifier.ts`)
  implements the existing `ClaimVerifier` port and decides whether a bundle's
  NEC evidence satisfies APEL's pre-committed proposition. NEC never decides
  anything about APEL claims.

## The narrow settlement proposition (D_narrow)

> The payment pre-committed by the APEL verification plan — network, asset,
> payer, payTo, amount — matches the observed effect of the exact executed
> transaction, and the containing Base L2 block is FINALIZED under
> `opstack.rpc-finalized-head-v1`.

This is deliberately narrower than "settlement". It does NOT establish:

- OP Stack withdrawal finalization or L1 withdrawal claimability;
- arbitrary economic irreversibility of funds;
- work completion, service quality, or commercial obligation;
- payment authorization policy (no x402 authorization semantics evaluated);
- refund, release, or any other economic decision.

Interaction/payment correlation MUST come from the plan: the verifier reads
expected terms exclusively from the claim's pre-committed `payment`
parameters and never from the artifact.

## Plan commitment (plan spec 0.2)

`ONCHAIN_SETTLEMENT` claim parameters now carry, in addition to
`artifactId` and `issuerId`, a `payment` expectation:

```json
{
  "artifactId": "nec-evidence-positive",
  "issuerId": "nec-network-verifier",
  "payment": {
    "network": "eip155:8453",
    "asset": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    "payer": "0x8f6272112c3b71474f6e24a8ad0be3b253123474",
    "payTo": "0x3c4384f3664b37a3cb5a5cb3452b4b4a3aa1256f",
    "amount": "27146486",
    "transactionHash": "0x26691412a743c61a7cd775c08b218ca9189c0dd536bad61636f04d8cb0e5e627"
  }
}
```

This is a correlation commitment only; it authorizes nothing.

## Evidence artifact boundary

The evidence artifact is an APEL `EvidenceArtifact` of kind
`apel.nec-network-evidence.v1` issued by an `INDEPENDENT_OBSERVER`. This is an
**APEL-specific evidence envelope carrying frozen NEC public evaluator
outputs**. It is deliberately NOT called a native NEC core
`NetworkEvidenceResult`: the payload is not a `nec-wire-json-v1`-encoded core
wire artifact but an integration envelope embedding two frozen-profile
evaluator outputs. No new NEC profile is created or implied.

```json
{
  "necEvidence": {
    "wireProfile": "nec-wire-json-v1",
    "coreSchemaVersion": "0.1",
    "evmEvaluation": { "profile": "nec-resolver-evm-evaluation-v1", "...": "..." },
    "opStackFinalityEvaluation": { "profile": "nec-resolver-opstack-evaluation-v1", "...": "..." }
  }
}
```

Bigint quantities are serialized as decimal strings exactly like the frozen
`nec-wire-json-v1` quantity encoding. The producer-side raw acquisition
fixtures (byte-exact captured RPC responses) are also committed under
`tests/fixtures/nec/` with a SHA-256 manifest. APEL does not recompute
NEC-internal capture digests; instead, anyone holding a checkout of the
frozen NEC workspace at the pinned freeze commits can replay those raw
fixtures offline (`replayTransactionAcquisition` /
`replayOpStackFinalityObservation`) and reproduce, byte-for-byte, the
evaluations embedded in the artifacts — this round-trip was proven with
poisoned global fetch before the bytes were frozen.

The verifier requires the artifact to carry NEC's standing
`WITHDRAWAL_FINALIZATION_NOT_EVALUATED` non-claim: an artifact whose
producer does not state that boundary claims strictly more than frozen NEC
emits and is rejected as `UNSUPPORTED_NEC_EVIDENCE_PROFILE`.

## Status mapping: NEC verdicts keep their epistemic weight

APEL is the authority over its own claim, but it must not flatten what frozen
NEC actually reported. Each dimension (`execution`, `dataBinding`, `finality`)
is mapped independently and identically:

| frozen NEC dimension observation | APEL `ONCHAIN_SETTLEMENT` | reason code |
| --- | --- | --- |
| `applicable` + `supported` | evaluation continues toward `PROVEN` | — |
| `applicable` + `contradicted` | `NOT_PROVEN` | `NEC_EXECUTION_CONTRADICTED`, `NEC_DATABINDING_CONTRADICTED`, `NEC_FINALITY_CONTRADICTED` |
| `applicable` + `insufficient` | `UNKNOWN` | `NEC_EXECUTION_INSUFFICIENT`, `NEC_DATABINDING_INSUFFICIENT`, `NEC_FINALITY_INSUFFICIENT` |
| `applicable` + `ambiguous` | `UNKNOWN` | `NEC_EXECUTION_AMBIGUOUS`, `NEC_DATABINDING_AMBIGUOUS`, `NEC_FINALITY_AMBIGUOUS` |
| applicability not `applicable` (unknown / absent) | `UNKNOWN` | `NEC_DIMENSION_NOT_EVALUATED` / `NEC_FINALITY_NOT_EVALUATED` |

Critical example: `OP_ANCESTRY_DEPTH_EXCEEDED` with verdict `insufficient`
means the frozen NEC resolver could not establish the required finalized-head
ancestry **within its bounded ruleset**. It does NOT mean the block is not
finalized. The honest mapping is therefore
`ONCHAIN_SETTLEMENT = UNKNOWN / NEC_FINALITY_INSUFFICIENT`, never
`NOT_PROVEN`. The frozen 10,000-block ceiling is never weakened to make a
case pass.

## Local ERC-20 re-derivation matches the frozen interpreter exactly

APEL imports no NEC runtime package. Its local structural parser mirrors the
frozen `@nec/adapter-x402` (`x402-v0.1-freeze`,
`packages/adapter-x402/src/interpret.ts`) rules for Transfer-shaped logs and
is never more permissive than that freeze:

- `removed` must be a boolean; `removed === true` excludes the log;
  - the generic log-observation envelope must be intact: an effect whose
    `fields` are missing, `null`, an array, or otherwise not a plain record is
    excluded (malformed), never treated as unrelated;
  - a missing or non-boolean `removed` flag violates the same contract and is
    excluded before any topic inspection;
- every topic must be exactly `0x` + 64 hex characters;
- `topic0` must equal the ERC-20 `Transfer` topic constant;
- an interpreted Transfer has exactly 3 topics — no fourth topic, no
  truncated or oversized words;
- indexed address topics must carry zero high-12-byte padding; the low 20
  bytes decode as the address;
- `fields.address` must be exactly `0x` + 40 hex characters;
- `fields.data` must be exactly one 32-byte word (`0x` + 64 hex characters);
- optional `transactionHash`, `blockNumber`, and `logIndex` context fields
  must be well-formed when present.

A log claiming the Transfer topic0 that violates any remaining rule is
excluded, never partially interpreted. Excluded transfer-shaped evidence
yields `UNKNOWN / NEC_PAYMENT_EFFECT_UNUSABLE`: unusable carriers can back
neither side of the predicate (malformed evidence is not valid negative
evidence). Adversarial tests cover extra topics, short and oversized words,
non-zero padding, malformed addresses and transaction hashes, `removed=true`,
and the envelope-level cases above — missing / non-record `fields` and
missing / non-boolean `removed`; all fail closed.

## What PROVEN requires

`PROVEN / NEC_ONCHAIN_PAYMENT_EFFECT_FINALIZED` requires ALL of:

1. artifact-envelope digest validity, Ed25519 signature verification, and
   issuer/key binding inside the validated bundle and pre-committed trust
   context, plus interaction correlation between the selected artifact and
   the plan subject;
2. frozen profiles: `nec-wire-json-v1`, core schema `0.1`,
   `nec-resolver-evm-evaluation-v1`, `nec-resolver-opstack-evaluation-v1`;
3. both halves bound to exactly the pre-committed network and transaction;
4. `execution = supported`;
5. `dataBinding = supported`;
6. `finality = supported` under pinned `opstack.rpc-finalized-head-v1`
   version `1`;
7. independent re-derivation of the ERC-20 `Transfer` correlation from the
   raw observed log fields against the pre-committed terms, with no effect
   citing a different transaction.

Fixture payment values are not hard-coded: the verifier accepts whatever
replayed evidence actually emits, and maps every weaker outcome to explicit
`NOT_PROVEN` / `UNKNOWN` reason codes in the report spec 0.2 compatibility
matrix, preserving the epistemic weight table above. What IS intentionally
pinned (fail-closed) are the contract constants: NEC profile identifiers
(`nec-wire-json-v1`, core schema `0.1`, the two frozen evaluation profiles),
the ERC-20 `Transfer` topic constant, and the OP Stack family/ruleset/version
(`opstack` / `opstack.rpc-finalized-head-v1` / `1`).

## Boundary statements

- **APEL decides its own settlement claim; NEC reports only what one
  configured network source independently supports.**
- **execution/effect/finality != economicAction.** Every positive and
  negative path in `tests/unit/nec-onchain-verifier.test.ts` asserts
  `economicAction == NOT_EVALUATED`.
- **OP Stack L2 finality != withdrawal finalization.** The ruleset observes
  a finalized L2 head through one source; it does not evaluate dispute-game
  completion, withdrawal claimability on L1, or economic irreversibility.
- **The underlying network transaction and RPC observations were not produced by APEL; the APEL EvidenceArtifact envelope is locally created and signed by the integration fixture identity.**

## NETWORK-VERIFIER FIXTURE provenance

Real Base mainnet evidence, captured through the FROZEN NEC resolver
pipelines against one public RPC source, then replayed offline with poisoned
global fetch to prove byte-exact reproduction before freezing.

Precisely scoped provenance claims:

- The committed Base network observations (transaction, logs, receipts,
  finality observations) are **real public network evidence**; they were not
  synthesized.
- The evaluator outputs embedded in each artifact were **reproduced using
  frozen NEC logic** at the pinned freeze commits (see "Reproducing the
  fixtures" below).
- The `EvidenceArtifact` envelope wrapping those outputs is **locally created
  in this lab** and **Ed25519-signed by the integration fixture identity**
  declared in the committed trust context. Within this lab that signature
  authenticates the issuer and integrity-binds the APEL envelope bytes
  against tampering after signing.
- That signature is **NOT a signature from the RPC provider**, and it is
  **NOT cryptographic proof that NEC itself produced the bytes**. The link to
  NEC rests on the reproducibility procedure above, not on a producer
  signature.
- `issuer.role = INDEPENDENT_OBSERVER` is a **declared trust-role premise of
  this research integration**, not an independently established fact; a real
  deployment must establish issuer independence itself before relying on it.

### Positive fixture (finalized within the bounded walk)

| field | value |
| --- | --- |
| tx | `0x26691412a743c61a7cd775c08b218ca9189c0dd536bad61636f04d8cb0e5e627` |
| containing block | `50471753` |
| network | `eip155:8453` (Base) |
| asset | `0x833589fcd6edb6e08f4c7c32d4f71b54bda02913` (USDC) |
| payer -> payTo | `0x8f6272112c3b71474f6e24a8ad0be3b253123474` -> `0x3c4384f3664b37a3cb5a5cb3452b4b4a3aa1256f` |
| amount | `27146486` atomic units (27.146486 USDC) |
| NEC verdicts | execution=supported, dataBinding=supported, finality=supported |

Selected because its finalized->subject ancestry walk (15 blocks at capture)
fits the frozen 10,000-block ceiling and therefore the bounded
fixture/replay profile.

### Audited candidate revalidation (honest insufficiency)

The previously audited candidate remains independently replayable as a
transaction and all its facts revalidated:

| field | value |
| --- | --- |
| tx | `0x16ffd11680eb81e334d8865d60969480861792a1089dbde4781726c777edd731` |
| containing block | `50455056` |
| asset | USDC |
| payer -> payTo | `0xc681c439995394f83d2e5b24dd75f0437815b492` -> `0x1d7f97d26ae2c01f9b01fc252b73cf0db3397e95` |
| amount | `4140000` atomic units (4.14 USDC) |
| NEC finality verdict at re-capture | `insufficient` (`OP_ANCESTRY_DEPTH_EXCEEDED`) |

Its earlier ~22-block finalized ancestry window closed before this
integration was written: by re-capture time the observed finalized head had
advanced ~15,969 blocks above the subject, exceeding the frozen ceiling. NEC
was not weakened; the honest outcome became the authentic
finality-insufficient negative fixture. Under the corrected semantics this
case maps to `ONCHAIN_SETTLEMENT = UNKNOWN / NEC_FINALITY_INSUFFICIENT`: the
bounded walk could not establish finalization, which is not an assertion
that the block is unfinalized. The positive demonstration therefore uses the
fresh real transfer above.

## Reproducing the fixtures

Fixtures were produced outside this repository by running the frozen NEC
workspace pipelines (acquisition -> evaluation -> offline replay round-trip
with poisoned fetch -> serialization):

```
acquireTransactionObservation        (@nec/resolver-evm, includeTransaction)
evaluateTransactionAcquisition       -> execution + dataBinding + effects
acquireOpStackFinalityObservation    (@nec/resolver-opstack)
evaluateOpStackFinality              ({config, evm, finality})
buildEvmAcquisitionFixture / buildOpStackFinalityFixture
replay* with global fetch poisoned   -> deep-equal round-trip proof
```

The serialized evaluator outputs (bigint quantities as decimal strings per
`nec-wire-json-v1`) become the artifact content bytes committed here. No NEC
package is imported by this repository's runtime or tests.

## Test coverage map

See `tests/unit/nec-onchain-verifier.test.ts`: positive, wrong recipient /
payer / amount / asset, full verdict-mapping matrices for execution,
dataBinding, and finality (supported / contradicted / insufficient /
ambiguous / not-evaluated), the real depth-exceeded insufficiency mapped to
`UNKNOWN`, safe-but-not-finalized / broken ancestry / canonical hash
mismatch / changing finalized head variants, malformed ERC-20 structure
adversarial cases (extra fourth topic, short and oversized topics and data
words, non-zero indexed-address padding, malformed token address and
transaction hash, `removed=true`) all failing closed, envelope-level
malformations (missing / non-record `fields`, missing / non-boolean
`removed`) mapped to `UNKNOWN / NEC_PAYMENT_EFFECT_UNUSABLE`, missing /
malformed / tampered-digest / unsupported-profile artifacts,
unrelated-transaction and cross-interaction correlation rejection,
authentication reuse, plan-schema canonical-amount enforcement, proof that
the default core verifier still returns `UNKNOWN` for `ONCHAIN_SETTLEMENT`,
and end-to-end validation of REAL generated verifier reports against
`schemas/verification-report.schema.json` for representative PROVEN /
NOT_PROVEN / UNKNOWN outcomes (decisive negatives cite the selected artifact
id). Every positive, negative, and unknown path asserts
`economicAction == NOT_EVALUATED`.
