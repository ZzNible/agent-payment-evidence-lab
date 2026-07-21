# Evidence report: independent-source-statement

> Evidence analysis only. This report does not authorize, release, retain, refund, or transfer funds.

## Result

| PROVEN | NOT_PROVEN | UNKNOWN | Economic action |
| ---: | ---: | ---: | --- |
| 8 | 0 | 5 | **NOT_EVALUATED** |

## Input commitment

- Interaction: `independent-source-statement-17b33e92-50d4-49d5-921c-50cf1bf4b18b`
- Plan: `plan-independent-source-statement-17b33e92-50d4-49d5-921c-50cf1bf4b18b` — `sha256:4cb7090ce71d6100387af00bb6fe407e4024f5ca776f446ee8ff11e6fcfa1076`
- Evidence bundle: `bundle-independent-source-statement-17b33e92-50d4-49d5-921c-50cf1bf4b18b` — `sha256:25bd2aa1ff56611d95bf6141186f197932bbb9ec6de36a4caae447abdf495b20`
- Engine: `agent-payment-evidence-lab@0.1.0`

## Claim-by-claim assessment

| Claim | Type | Status | Reason | Evidence |
| --- | --- | --- | --- | --- |
| `artifact-digests` | `DIGEST_VALID` | ✅ PROVEN | `ALL_SELECTED_DIGESTS_VALID` | `output-schema`, `http-response`, `payment-verification`, `settlement-boundary`, `completion-statement` |
| `interaction-correlation` | `CORRELATION_MATCH` | ✅ PROVEN | `INTERACTION_CORRELATION_MATCHED` | `output-schema`, `http-response`, `payment-verification`, `settlement-boundary`, `completion-statement` |
| `payment-verified` | `PAYMENT_VERIFIED` | ✅ PROVEN | `FACILITATOR_ACCEPTED_PAYMENT_PAYLOAD` | `payment-verification` |
| `settlement-boundary` | `SETTLEMENT_BOUNDARY_SUCCEEDED` | ✅ PROVEN | `LOCAL_SETTLEMENT_BOUNDARY_SUCCEEDED` | `settlement-boundary` |
| `onchain-settlement` | `ONCHAIN_SETTLEMENT` | ❔ UNKNOWN | `NO_ONCHAIN_CONFIRMATION_EVIDENCE` | — |
| `http-response-received` | `HTTP_RESPONSE_RECEIVED` | ✅ PROVEN | `HTTP_RESPONSE_CAPTURED` | `http-response` |
| `http-status` | `HTTP_STATUS_MATCH` | ✅ PROVEN | `HTTP_STATUS_MATCHED` | `http-response` |
| `response-bound-to-payment` | `RESPONSE_BODY_BOUND_TO_PAYMENT` | ❔ UNKNOWN | `PAYMENT_RECEIPT_HAS_NO_RESPONSE_BODY_BINDING` | `http-response`, `settlement-boundary` |
| `obligation-fulfilled` | `OBLIGATION_FULFILLED` | ❔ UNKNOWN | `COMMERCIAL_OBLIGATION_NOT_EVALUATED` | — |
| `source-statement` | `SOURCE_STATEMENT_OBSERVED` | ✅ PROVEN | `SOURCE_STATEMENT_MATCHED` | `completion-statement` |
| `source-authenticated` | `SOURCE_AUTHENTICATED` | ✅ PROVEN | `ED25519_SIGNATURE_VALID` | `completion-statement` |
| `source-independent` | `SOURCE_INDEPENDENT` | ❔ UNKNOWN | `SOURCE_INDEPENDENCE_NOT_ESTABLISHED` | `completion-statement` |
| `source-authoritative` | `SOURCE_AUTHORITATIVE` | ❔ UNKNOWN | `SOURCE_AUTHORITY_NOT_ESTABLISHED` | `completion-statement` |

## Limitations

- **payment-verified:** The local facilitator is synthetic and does not establish validity on a production network.
- **settlement-boundary:** This is a successful call to the recording facilitator boundary, not an on-chain transfer.
- **settlement-boundary:** No real funds moved.
- **onchain-settlement:** The recording facilitator never claims that a blockchain transaction occurred.
- **http-response-received:** Receiving an authenticated fixture response does not establish fulfilment.
- **obligation-fulfilled:** The lab evaluates explicit technical predicates, not the full commercial obligation.
- **obligation-fulfilled:** No economic action follows from this report.
- **source-statement:** The bundle contains a matching statement attributed to this source; authentication is a separate claim.
- **source-statement:** Presence does not establish that the statement is true.
- **source-authenticated:** A valid signature establishes integrity and control of the signing key, not truth.

## Interpretation

- **PROVEN** means the cited valid evidence implies the narrow proposition under the declared trust profile.
- **NOT_PROVEN** means enough evidence exists to evaluate the predicate and it was not satisfied. It does not by itself mean fraud.
- **UNKNOWN** means evidence, authority, independence, freshness, or scope is insufficient.
- A successful local settlement boundary is not an on-chain confirmation and does not mean real funds moved.
- HTTP success, schema conformance, source authentication, source independence, source authority, and commercial fulfilment are separate propositions.

**Economic action: NOT_EVALUATED.**
