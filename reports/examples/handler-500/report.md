# Evidence report: handler-500

> Evidence analysis only. This report does not authorize, release, retain, refund, or transfer funds.

## Result

| PROVEN | NOT_PROVEN | UNKNOWN | Economic action |
| ---: | ---: | ---: | --- |
| 5 | 1 | 3 | **NOT_EVALUATED** |

## Input commitment

- Interaction: `handler-500-2bfcd5f1-c228-4ebe-87d0-9e8c08b37e2c`
- Plan: `plan-handler-500-2bfcd5f1-c228-4ebe-87d0-9e8c08b37e2c` — `sha256:9f177cf4ef960f5a26b3607be55374000fa552b51fc70c336740faa390566840`
- Evidence bundle: `bundle-handler-500-2bfcd5f1-c228-4ebe-87d0-9e8c08b37e2c` — `sha256:843bdd230942e795603cc6c782283172a9b01323ac68e634fa89c037d6168263`
- Engine: `agent-payment-evidence-lab@0.1.0`

## Claim-by-claim assessment

| Claim | Type | Status | Reason | Evidence |
| --- | --- | --- | --- | --- |
| `artifact-digests` | `DIGEST_VALID` | ✅ PROVEN | `ALL_SELECTED_DIGESTS_VALID` | `output-schema`, `http-response`, `payment-verification`, `payment-cancellation` |
| `interaction-correlation` | `CORRELATION_MATCH` | ✅ PROVEN | `INTERACTION_CORRELATION_MATCHED` | `output-schema`, `http-response`, `payment-verification`, `payment-cancellation` |
| `payment-verified` | `PAYMENT_VERIFIED` | ✅ PROVEN | `FACILITATOR_ACCEPTED_PAYMENT_PAYLOAD` | `payment-verification` |
| `settlement-boundary` | `SETTLEMENT_BOUNDARY_SUCCEEDED` | ❌ NOT_PROVEN | `SETTLEMENT_SKIPPED_AFTER_HANDLER_FAILURE` | `payment-cancellation` |
| `onchain-settlement` | `ONCHAIN_SETTLEMENT` | ❔ UNKNOWN | `NO_ONCHAIN_CONFIRMATION_EVIDENCE` | — |
| `http-response-received` | `HTTP_RESPONSE_RECEIVED` | ✅ PROVEN | `HTTP_RESPONSE_CAPTURED` | `http-response` |
| `http-status` | `HTTP_STATUS_MATCH` | ✅ PROVEN | `HTTP_STATUS_MATCHED` | `http-response` |
| `response-bound-to-payment` | `RESPONSE_BODY_BOUND_TO_PAYMENT` | ❔ UNKNOWN | `RESPONSE_OR_SETTLEMENT_EVIDENCE_MISSING` | — |
| `obligation-fulfilled` | `OBLIGATION_FULFILLED` | ❔ UNKNOWN | `COMMERCIAL_OBLIGATION_NOT_EVALUATED` | — |

## Limitations

- **payment-verified:** The local facilitator is synthetic and does not establish validity on a production network.
- **onchain-settlement:** The recording facilitator never claims that a blockchain transaction occurred.
- **http-response-received:** Receiving an authenticated fixture response does not establish fulfilment.
- **obligation-fulfilled:** The lab evaluates explicit technical predicates, not the full commercial obligation.
- **obligation-fulfilled:** No economic action follows from this report.

## Interpretation

- **PROVEN** means the cited valid evidence implies the narrow proposition under the declared trust profile.
- **NOT_PROVEN** means enough evidence exists to evaluate the predicate and it was not satisfied. It does not by itself mean fraud.
- **UNKNOWN** means evidence, authority, independence, freshness, or scope is insufficient.
- A successful local settlement boundary is not an on-chain confirmation and does not mean real funds moved.
- HTTP success, schema conformance, source authentication, source independence, source authority, and commercial fulfilment are separate propositions.

**Economic action: NOT_EVALUATED.**
