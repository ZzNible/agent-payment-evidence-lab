# Known Unknowns

This laboratory has a deliberately narrow job: make the evidentiary boundary of an agent-payment interaction visible and reproducible.

It does **not** establish that there is a market for an independent clearing service, that a buyer would delegate payment authority, or that any particular evidence source is economically neutral. Those are empirical questions. Keeping them explicit is part of the project, not a disclaimer added after the fact.

## What the laboratory can establish

Within the pinned implementation and the declared local trust model, the experiments can establish facts such as:

- whether the `@x402/express` 2.19.0 middleware attempted settlement after a given handler result;
- whether the synthetic facilitator recorded a verification, settlement, failure, or cancellation event;
- whether an observed JSON response conforms to a precommitted schema;
- whether an artifact digest matches the bytes that were evaluated;
- whether a plan, evidence bundle, and report refer to the same interaction;
- whether a named source emitted a particular statement, when the relevant identity and integrity mechanism is available;
- whether the available artifacts are sufficient for a narrowly defined claim.

These are technical propositions. They are useful precisely because they are smaller than “the service was delivered correctly.”

## What the laboratory does not establish

The current version cannot establish:

- that real funds moved or are final on a production network;
- that a production facilitator would verify or settle the same payment;
- that a syntactically valid output is useful, correct, complete, or commercially acceptable;
- that HTTP `200` means an asynchronous job later succeeded;
- that a payment receipt is cryptographically bound to the response body or to a commercial obligation;
- that a source is independent merely because it has a different identifier or signing key;
- that a source is authoritative for the contract merely because it reports a status;
- that an organization is neutral, solvent, insured, or free from conflicts of interest;
- that a technical report should release, retain, or refund money.

Every generated report therefore fixes:

```json
{
  "economicAction": "NOT_EVALUATED"
}
```

There is no global commercial `PASS` or `FAIL` in the model.

## Known implementation facts

The harness pins x402 packages at version `2.19.0`. In that version, the Express middleware buffers the handler response before settlement. A handler response with status `>= 400` is not settled and produces a verified-payment cancellation; a thrown handler produces a separate cancellation reason. A successful handler response can proceed to settlement.

This is a fact about the pinned implementation, not a claim about every x402 deployment or future release. See the upstream [Express middleware](https://github.com/x402-foundation/x402/blob/67b1ba0a7abbd7907a28fa624670872532e0eae9/typescript/packages/http/express/src/index.ts) and its [tests](https://github.com/x402-foundation/x402/blob/67b1ba0a7abbd7907a28fa624670872532e0eae9/typescript/packages/http/express/src/index.test.ts).

The local facilitator is synthetic. It records lifecycle calls and returns controlled outcomes, but it does not:

- validate production payment credentials;
- contact a blockchain or payment network;
- transfer assets;
- prove economic finality;
- model every facilitator implementation.

The lab executes real middleware control flow around a simulated payment boundary. Its conclusions must not be promoted from “the middleware called settlement” to “money moved in production.”

## Technical unknowns the lab can reduce

These questions can be investigated by extending the executable scenarios:

| Question | Useful experiment | What would remain unresolved |
| --- | --- | --- |
| Can payment, response, and later job state be correlated without ambiguity? | Add nonces, interaction IDs, digests, and replay tests | Whether production systems expose the required identifiers |
| Does a receipt bind the delivered bytes? | Compare signed/recorded receipt fields with a response digest | Whether a rail will standardize or enforce that binding |
| Can an external statement be acquired without trusting the provider? | Add a read-only evidence adapter or verifiable web provenance proof | Whether the external system is independent and contractually authoritative |
| Can evidence be replayed across jobs? | Attempt cross-interaction substitution and stale-artifact reuse | Whether production clocks, identifiers, and retention policies are adequate |
| Can another protocol fit the same evidence model? | Add a read-only adapter and golden scenarios | Whether the protocol owner will expose or absorb the evaluator role |

The lab can clarify the *shape* of these problems. It cannot manufacture production access or institutional trust.

## Empirical unknowns that decide whether there is a business

No amount of local code answers the following:

1. **Frequency** — How often does a payment settle while the paid-for asynchronous work later fails, degrades, or never completes?
2. **Loss** — What does that failure cost, and who bears the cost?
3. **Salience** — Does the affected party care enough to change a workflow or pay to prevent it?
4. **Independent state** — Is there a system that observes the relevant outcome and is controlled by neither transacting party?
5. **Authority** — Would both parties accept that system, or a derived attestation, as the pre-agreed trigger for settlement?
6. **Direct-read redundancy** — If the source is authoritative, why can the payment rail or marketplace not read it directly?
7. **Payer** — Would the buyer, provider, marketplace, or rail pay for the evidence layer?
8. **Unit economics** — Can the fee cover evidence acquisition, exceptions, liability, insurance, and support at the transaction values where authority is delegable?
9. **Defensibility** — Does durable value live in evidence acquisition, provenance, exception handling, integration, or risk absorption—or will the rail/provenance provider commoditize it?
10. **Access** — Can we reach operators running real paid agent workflows, rather than only developers interested in the theory?

These require operator interviews, production traces, workflow access, and eventually transactions with real economic consequences. The repository is a better instrument for those conversations; it is not a substitute for them.

## Source independence is a relationship, not a signature property

An artifact can prove that key `K` signed the statement `job_status=completed`. That proves neither:

- who controls `K` in practice;
- whether the provider can cause the status to change;
- whether the source observed the underlying work;
- whether the source is independent of buyer and provider;
- whether the parties designated that source as authoritative.

The project therefore keeps four concepts separate:

1. **Identity** — which declared principal emitted the artifact;
2. **Integrity** — whether the artifact changed after issuance;
3. **Independence** — whether either party controls or can materially influence the source;
4. **Authority** — whether the precommitted plan treats that source as competent for the claim.

Only the first two are primarily cryptographic. Independence and authority require additional evidence and explicit trust assumptions.

## Falsification signals

The commercial hypothesis should be weakened or rejected if operator research shows that:

- paid-but-failed jobs are rare or economically immaterial;
- failures are already refunded automatically with negligible support cost;
- there is no outcome source outside the provider's control;
- buyers will not give up a discretionary veto even for narrow, low-risk predicates;
- providers will not pay for neutral evidence or payment assurance;
- the only accepted arrangement requires bespoke human negotiation for every job;
- the rail or marketplace can consume the authoritative proof directly with no distinct settlement or exception layer;
- liability and insurance cost more than the transaction can support.

Conversely, the existence of transaction volume alone is not validation. A useful signal includes a real failure, a measurable cost, an affected party, and willingness to adopt or pay for a specific remedy.

## Research discipline

When a new result is added, classify it before drawing a conclusion:

- **Implementation fact:** observed in a pinned version or reproducible fixture;
- **Protocol fact:** guaranteed by a normative specification;
- **Trust assumption:** accepted for the experiment but not independently demonstrated;
- **Empirical observation:** measured in a real workflow;
- **Commercial inference:** a hypothesis derived from observations.

The repository is strongest when it refuses to blur those categories.
