# Evidence report: valid-synchronous

> Evidence analysis only. This report does not authorize, release, retain, refund, or transfer funds.

## Result

| PROVEN | NOT_PROVEN | UNKNOWN | Economic action |
| ---: | ---: | ---: | --- |
| 7 | 0 | 3 | **NOT_EVALUATED** |

## Input commitment

- Interaction: `valid-synchronous-4510124a-af75-4430-a68f-ed98db22ff97`
- Plan: `plan-valid-synchronous-4510124a-af75-4430-a68f-ed98db22ff97` — `sha256:8ead69b20d8bb803076e6a8fcb620f688425f703a7a5f39b531e1dcb7dee9a20`
- Evidence bundle: `bundle-valid-synchronous-4510124a-af75-4430-a68f-ed98db22ff97` — `sha256:ad3bea6d76461ad1a7ae0413a71541acbea603fb35012e0effaa393fa03467aa`
- Engine: `agent-payment-evidence-lab@0.1.0`

## Claim-by-claim assessment

| Claim | Type | Status | Reason | Evidence |
| --- | --- | --- | --- | --- |
| `artifact-digests` | `DIGEST_VALID` | ✅ PROVEN | `ALL_SELECTED_DIGESTS_VALID` | `output-schema`, `http-response`, `payment-verification`, `settlement-boundary` |
| `interaction-correlation` | `CORRELATION_MATCH` | ✅ PROVEN | `INTERACTION_CORRELATION_MATCHED` | `output-schema`, `http-response`, `payment-verification`, `settlement-boundary` |
| `payment-verified` | `PAYMENT_VERIFIED` | ✅ PROVEN | `FACILITATOR_ACCEPTED_PAYMENT_PAYLOAD` | `payment-verification` |
| `settlement-boundary` | `SETTLEMENT_BOUNDARY_SUCCEEDED` | ✅ PROVEN | `LOCAL_SETTLEMENT_BOUNDARY_SUCCEEDED` | `settlement-boundary` |
| `onchain-settlement` | `ONCHAIN_SETTLEMENT` | ❔ UNKNOWN | `NO_ONCHAIN_CONFIRMATION_EVIDENCE` | — |
| `http-response-received` | `HTTP_RESPONSE_RECEIVED` | ✅ PROVEN | `HTTP_RESPONSE_CAPTURED` | `http-response` |
| `http-status` | `HTTP_STATUS_MATCH` | ✅ PROVEN | `HTTP_STATUS_MATCHED` | `http-response` |
| `response-bound-to-payment` | `RESPONSE_BODY_BOUND_TO_PAYMENT` | ❔ UNKNOWN | `PAYMENT_RECEIPT_HAS_NO_RESPONSE_BODY_BINDING` | `http-response`, `settlement-boundary` |
| `obligation-fulfilled` | `OBLIGATION_FULFILLED` | ❔ UNKNOWN | `COMMERCIAL_OBLIGATION_NOT_EVALUATED` | — |
| `output-schema` | `OUTPUT_SCHEMA_VALID` | ✅ PROVEN | `JSON_SCHEMA_MATCH` | `http-response`, `output-schema` |

## Limitations

- **payment-verified:** The local facilitator is synthetic and does not establish validity on a production network.
- **settlement-boundary:** This is a successful call to the recording facilitator boundary, not an on-chain transfer.
- **settlement-boundary:** No real funds moved.
- **onchain-settlement:** The recording facilitator never claims that a blockchain transaction occurred.
- **http-response-received:** Receiving an authenticated fixture response does not establish fulfilment.
- **obligation-fulfilled:** The lab evaluates explicit technical predicates, not the full commercial obligation.
- **obligation-fulfilled:** No economic action follows from this report.
- **output-schema:** Schema conformance is narrower than commercial fulfilment.

## Interpretation

- **PROVEN** means the cited valid evidence implies the narrow proposition under the declared trust profile.
- **NOT_PROVEN** means enough evidence exists to evaluate the predicate and it was not satisfied. It does not by itself mean fraud.
- **UNKNOWN** means evidence, authority, independence, freshness, or scope is insufficient.
- A successful local settlement boundary is not an on-chain confirmation and does not mean real funds moved.
- HTTP success, schema conformance, source authentication, source independence, source authority, and commercial fulfilment are separate propositions.

**Economic action: NOT_EVALUATED.**
