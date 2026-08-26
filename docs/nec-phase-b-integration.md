# NEC Phase-B integration: external ONCHAIN_SETTLEMENT verification

Status: integration complete for `apel.verification-plan/0.2` +
`apel.verification-report/0.2`.

This document describes the Phase-B integration between this lab (APEL) and
the external [NEC (network evidence core)](https://github.com/ZzNible/network-evidence-core)
repository. It is the single authoritative description of what the
integration proves and — equally important — what it does not.

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
`nec.network-evidence-result` issued by an `INDEPENDENT_OBSERVER`. Its
content embeds two frozen-profile NEC evaluator outputs:

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

## What PROVEN requires

`PROVEN / NEC_ONCHAIN_PAYMENT_EFFECT_FINALIZED` requires ALL of:

1. artifact integrity (bundle digest), interaction correlation, issuer/key
   authentication under the committed trust profile;
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

Nothing is hard-coded: the verifier accepts whatever replayed evidence
actually emits, and maps any weaker outcome to explicit `NOT_PROVEN` /
`UNKNOWN` reason codes added by the report spec 0.2 compatibility matrix.

## Boundary statements

- **APEL decides its own settlement claim; NEC reports only what one
  configured network source independently supports.**
- **execution/effect/finality != economicAction.** Every positive and
  negative path in `tests/unit/nec-onchain-verifier.test.ts` asserts
  `economicAction == NOT_EVALUATED`.
- **OP Stack L2 finality != withdrawal finalization.** The ruleset observes
  a finalized L2 head through one source; it does not evaluate dispute-game
  completion, withdrawal claimability on L1, or economic irreversibility.
- **The fixture was not produced by APEL.**

## NETWORK-VERIFIER FIXTURE provenance

Real Base mainnet evidence, captured through the FROZEN NEC resolver
pipelines against one public RPC source, then replayed offline with poisoned
global fetch to prove byte-exact reproduction before freezing.

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
finality-insufficient negative fixture. The positive demonstration therefore
uses the fresh real transfer above.

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
payer / amount / asset, reverted-execution variant, real depth-exceeded
insufficiency, safe-but-not-finalized / broken ancestry / canonical hash
mismatch / changing finalized head variants, missing / malformed /
tampered-digest / unsupported-profile artifacts, unrelated-transaction and
cross-interaction correlation rejection, authentication reuse, and proof
that the default core verifier still returns `UNKNOWN` for
`ONCHAIN_SETTLEMENT`.
