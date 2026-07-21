import Ajv2020, { type ErrorObject, type Options, type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { artifactEnvelope, findArtifact } from "../domain/artifacts.js";
import type {
  ClaimResult,
  ClaimStatus,
  ClaimType,
  EvidenceArtifact,
  IssuerRole,
  PlanClaim
} from "../domain/types.js";
import type { ClaimVerifier, VerificationContext } from "../ports/claim-verifier.js";
import { canonicalJson } from "../security/canonical-json.js";
import { sha256 } from "../security/digest.js";
import { verifyJsonSignature } from "../security/signatures.js";

const supportedClaimTypes = [
  "PAYMENT_VERIFIED",
  "SETTLEMENT_BOUNDARY_SUCCEEDED",
  "ONCHAIN_SETTLEMENT",
  "HTTP_RESPONSE_RECEIVED",
  "HTTP_STATUS_MATCH",
  "OUTPUT_SCHEMA_VALID",
  "JOB_TERMINAL_SUCCESS",
  "DIGEST_VALID",
  "CORRELATION_MATCH",
  "SOURCE_STATEMENT_OBSERVED",
  "SOURCE_AUTHENTICATED",
  "SOURCE_INDEPENDENT",
  "SOURCE_AUTHORITATIVE",
  "RESPONSE_BODY_BOUND_TO_PAYMENT",
  "OBLIGATION_FULFILLED"
] as const satisfies readonly ClaimType[];

interface AjvLike {
  compile(schema: object): ValidateFunction;
}

const AjvConstructor = Ajv2020 as unknown as new (options?: Options) => AjvLike;
const installFormats = addFormats as unknown as (ajv: AjvLike) => unknown;
export class CoreClaimVerifier implements ClaimVerifier {
  readonly claimTypes = supportedClaimTypes;
  private readonly ajv = createAjv();

  verify(claim: PlanClaim, context: VerificationContext): ClaimResult {
    switch (claim.type) {
      case "PAYMENT_VERIFIED":
        return this.paymentVerified(claim, context);
      case "SETTLEMENT_BOUNDARY_SUCCEEDED":
        return this.settlementSucceeded(claim, context);
      case "ONCHAIN_SETTLEMENT":
        return this.onchainSettlement(claim, context);
      case "HTTP_RESPONSE_RECEIVED":
        return this.httpResponseReceived(claim, context);
      case "HTTP_STATUS_MATCH":
        return this.httpStatusMatch(claim, context);
      case "OUTPUT_SCHEMA_VALID":
        return this.outputSchemaValid(claim, context);
      case "JOB_TERMINAL_SUCCESS":
        return this.jobTerminalSuccess(claim, context);
      case "DIGEST_VALID":
        return this.digestValid(claim, context);
      case "CORRELATION_MATCH":
        return this.correlationMatch(claim, context);
      case "SOURCE_STATEMENT_OBSERVED":
        return this.sourceStatementObserved(claim, context);
      case "SOURCE_AUTHENTICATED":
        return this.sourceAuthenticated(claim, context);
      case "SOURCE_INDEPENDENT":
        return this.sourceIndependent(claim, context);
      case "SOURCE_AUTHORITATIVE":
        return this.sourceAuthoritative(claim, context);
      case "RESPONSE_BODY_BOUND_TO_PAYMENT":
        return this.responseBodyBound(claim, context);
      case "OBLIGATION_FULFILLED":
        return result(
          claim,
          "UNKNOWN",
          "COMMERCIAL_OBLIGATION_NOT_EVALUATED",
          [],
          [
            "The lab evaluates explicit technical predicates, not the full commercial obligation.",
            "No economic action follows from this report."
          ]
        );
    }
  }

  private paymentVerified(claim: PlanClaim, context: VerificationContext): ClaimResult {
    const artifact = this.usableArtifact(claim, context, "x402.payment-verification");
    if (artifact === undefined) {
      return missing(claim, "NO_VALID_PAYMENT_VERIFICATION_EVIDENCE");
    }
    const authenticationFailure = this.artifactAuthenticationFailure(
      claim,
      artifact,
      context,
      ["PAYMENT_FACILITATOR"],
      "issuerId"
    );
    if (authenticationFailure !== undefined) {
      return authenticationFailure;
    }
    const content = asRecord(artifact.content);
    if (content?.mode !== "local-recording-double" || content.realNetworkVerification !== false) {
      return result(claim, "UNKNOWN", "UNSUPPORTED_PAYMENT_VERIFICATION_PROFILE", [artifact.id]);
    }
    const paymentPayload = asRecord(content?.paymentPayload);
    const paymentResource = asRecord(paymentPayload?.resource);
    const resourceUrl = paymentResource?.url;
    if (typeof resourceUrl !== "string") {
      return result(claim, "UNKNOWN", "PAYMENT_RESOURCE_BINDING_MISSING", [artifact.id]);
    }
    if (resourceUrl !== context.plan.subject.resource) {
      return result(claim, "NOT_PROVEN", "PAYMENT_RESOURCE_MISMATCH", [artifact.id]);
    }
    return content?.isValid === true
      ? result(claim, "PROVEN", "FACILITATOR_ACCEPTED_PAYMENT_PAYLOAD", [artifact.id], [
          "The local facilitator is synthetic and does not establish validity on a production network."
        ])
      : result(claim, "NOT_PROVEN", "PAYMENT_VERIFICATION_REJECTED", [artifact.id]);
  }

  private settlementSucceeded(claim: PlanClaim, context: VerificationContext): ClaimResult {
    const artifact = this.usableArtifact(claim, context, "x402.settlement-boundary");
    const cancellation = this.usableArtifact(
      claim,
      context,
      "x402.payment-cancellation",
      "cancellationArtifactId"
    );
    if (artifact !== undefined && cancellation !== undefined) {
      return result(
        claim,
        "UNKNOWN",
        "CONTRADICTORY_SETTLEMENT_EVIDENCE",
        [artifact.id, cancellation.id],
        ["The dossier contains both a settlement result and a verified-payment cancellation."]
      );
    }
    if (artifact !== undefined) {
      const authenticationFailure = this.artifactAuthenticationFailure(
        claim,
        artifact,
        context,
        ["PAYMENT_FACILITATOR"],
        "artifactIssuerId"
      );
      if (authenticationFailure !== undefined) {
        return authenticationFailure;
      }
      const content = asRecord(artifact.content);
      if (content?.mode !== "local-recording-double" || content.realFundsMoved !== false) {
        return result(claim, "UNKNOWN", "UNSUPPORTED_SETTLEMENT_PROFILE", [artifact.id]);
      }
      return content?.success === true
        ? result(claim, "PROVEN", "LOCAL_SETTLEMENT_BOUNDARY_SUCCEEDED", [artifact.id], [
            "This is a successful call to the recording facilitator boundary, not an on-chain transfer.",
            "No real funds moved."
          ])
        : result(claim, "NOT_PROVEN", "SETTLEMENT_BOUNDARY_FAILED", [artifact.id]);
    }

    if (cancellation !== undefined) {
      const authenticationFailure = this.artifactAuthenticationFailure(
        claim,
        cancellation,
        context,
        ["LAB_FIXTURE"],
        "cancellationIssuerId"
      );
      if (authenticationFailure !== undefined) {
        return authenticationFailure;
      }
      if (asRecord(cancellation.content)?.reason !== "handler_failed") {
        return result(claim, "UNKNOWN", "UNSUPPORTED_PAYMENT_CANCELLATION_PROFILE", [
          cancellation.id
        ]);
      }
      return result(claim, "NOT_PROVEN", "SETTLEMENT_SKIPPED_AFTER_HANDLER_FAILURE", [
        cancellation.id
      ]);
    }
    return missing(claim, "NO_VALID_SETTLEMENT_EVIDENCE");
  }

  private onchainSettlement(claim: PlanClaim, context: VerificationContext): ClaimResult {
    const artifact = this.usableArtifact(claim, context, "chain.transaction-confirmation");
    if (artifact === undefined) {
      return result(claim, "UNKNOWN", "NO_ONCHAIN_CONFIRMATION_EVIDENCE", [], [
        "The recording facilitator never claims that a blockchain transaction occurred."
      ]);
    }
    return result(claim, "UNKNOWN", "ONCHAIN_VERIFICATION_NOT_IMPLEMENTED", [artifact.id], [
      "The v0.1 lab has no chain-specific receipt, confirmation-depth, or finality verifier.",
      "A JSON artifact that says confirmed is not sufficient on-chain evidence."
    ]);
  }

  private httpResponseReceived(claim: PlanClaim, context: VerificationContext): ClaimResult {
    const artifact = this.usableArtifact(claim, context, "http.response");
    if (artifact === undefined) {
      return missing(claim, "NO_VALID_HTTP_RESPONSE_EVIDENCE");
    }
    const authenticationFailure = this.artifactAuthenticationFailure(
      claim,
      artifact,
      context,
      ["LAB_FIXTURE"],
      "issuerId"
    );
    if (authenticationFailure !== undefined) {
      return authenticationFailure;
    }
    if (!isHttpResponseArtifact(artifact.content)) {
      return result(claim, "UNKNOWN", "HTTP_RESPONSE_SHAPE_INVALID", [artifact.id]);
    }
    const resourceFailure = this.httpResourceFailure(claim, artifact, context);
    if (resourceFailure !== undefined) {
      return resourceFailure;
    }
    return result(claim, "PROVEN", "HTTP_RESPONSE_CAPTURED", [artifact.id], [
      "Receiving an authenticated fixture response does not establish fulfilment."
    ]);
  }

  private httpStatusMatch(claim: PlanClaim, context: VerificationContext): ClaimResult {
    const artifact = this.usableArtifact(claim, context, "http.response");
    if (artifact === undefined) {
      return missing(claim, "NO_VALID_HTTP_RESPONSE_EVIDENCE");
    }
    const authenticationFailure = this.artifactAuthenticationFailure(
      claim,
      artifact,
      context,
      ["LAB_FIXTURE"],
      "issuerId"
    );
    if (authenticationFailure !== undefined) {
      return authenticationFailure;
    }
    if (!isHttpResponseArtifact(artifact.content)) {
      return result(claim, "UNKNOWN", "HTTP_RESPONSE_SHAPE_INVALID", [artifact.id]);
    }
    const resourceFailure = this.httpResourceFailure(claim, artifact, context);
    if (resourceFailure !== undefined) {
      return resourceFailure;
    }
    const content = artifact.content;
    const expected = claim.parameters?.expected;
    const actual = content.status;
    if (typeof expected !== "number" || typeof actual !== "number") {
      return result(claim, "UNKNOWN", "HTTP_STATUS_PREDICATE_INCOMPLETE", [artifact.id]);
    }
    return actual === expected
      ? result(claim, "PROVEN", "HTTP_STATUS_MATCHED", [artifact.id])
      : result(claim, "NOT_PROVEN", "HTTP_STATUS_MISMATCH", [artifact.id]);
  }

  private outputSchemaValid(claim: PlanClaim, context: VerificationContext): ClaimResult {
    const response = this.usableArtifact(claim, context, "http.response", "responseArtifactId");
    const schema = this.usableArtifact(claim, context, "contract.output-schema", "schemaArtifactId");
    if (response === undefined || schema === undefined) {
      return missing(claim, "RESPONSE_OR_SCHEMA_EVIDENCE_MISSING");
    }
    const authenticationFailure = this.artifactAuthenticationFailure(
      claim,
      response,
      context,
      ["LAB_FIXTURE"],
      "responseIssuerId"
    );
    if (authenticationFailure !== undefined) {
      return authenticationFailure;
    }
    if (!isHttpResponseArtifact(response.content)) {
      return result(claim, "UNKNOWN", "HTTP_RESPONSE_SHAPE_INVALID", [response.id]);
    }
    const resourceFailure = this.httpResourceFailure(claim, response, context);
    if (resourceFailure !== undefined) {
      return resourceFailure;
    }

    const committedSchemaDigest = claim.parameters?.schemaDigest;
    if (
      typeof committedSchemaDigest !== "string" ||
      committedSchemaDigest !== sha256(schema.content)
    ) {
      return result(claim, "NOT_PROVEN", "SCHEMA_COMMITMENT_MISMATCH", [schema.id], [
        "The output predicate must use the exact schema committed in the pre-execution plan."
      ]);
    }

    const responseContent = response.content;
    if (!isJsonSchema(schema.content)) {
      return result(claim, "UNKNOWN", "SCHEMA_PREDICATE_NOT_EVALUABLE", [response.id, schema.id]);
    }

    try {
      const validate = this.ajv.compile(schema.content);
      const valid = validate(responseContent.body);
      return valid
        ? result(claim, "PROVEN", "JSON_SCHEMA_MATCH", [response.id, schema.id], [
            "Schema conformance is narrower than commercial fulfilment."
          ])
        : result(
            claim,
            "NOT_PROVEN",
            "JSON_SCHEMA_MISMATCH",
            [response.id, schema.id],
            formatAjvErrors(validate.errors)
          );
    } catch (error) {
      return result(claim, "UNKNOWN", "INVALID_OR_UNSUPPORTED_JSON_SCHEMA", [schema.id], [
        error instanceof Error ? error.message : String(error)
      ]);
    }
  }

  private jobTerminalSuccess(claim: PlanClaim, context: VerificationContext): ClaimResult {
    const artifact = this.usableArtifact(claim, context, "job.status", "artifactId");
    const response = this.usableArtifact(claim, context, "http.response", "responseArtifactId");
    if (artifact === undefined || response === undefined) {
      return missing(claim, "JOB_OR_RESPONSE_EVIDENCE_MISSING");
    }
    const jobAuthenticationFailure = this.artifactAuthenticationFailure(
      claim,
      artifact,
      context,
      ["PROVIDER", "EXTERNAL_SOURCE", "INDEPENDENT_OBSERVER", "LAB_FIXTURE"],
      "issuerId"
    );
    if (jobAuthenticationFailure !== undefined) {
      return jobAuthenticationFailure;
    }
    if (!context.bundle.trustContext.authoritativeSources.includes(artifact.issuer.id)) {
      return result(claim, "UNKNOWN", "JOB_SOURCE_AUTHORITY_NOT_ESTABLISHED", [artifact.id], [
        "Authentication proves who reported the state; the trust profile must separately designate that source as authoritative for the job claim."
      ]);
    }
    const responseAuthenticationFailure = this.artifactAuthenticationFailure(
      claim,
      response,
      context,
      ["LAB_FIXTURE"],
      "responseIssuerId"
    );
    if (responseAuthenticationFailure !== undefined) {
      return responseAuthenticationFailure;
    }
    if (!isHttpResponseArtifact(response.content)) {
      return result(claim, "UNKNOWN", "HTTP_RESPONSE_SHAPE_INVALID", [response.id]);
    }
    const resourceFailure = this.httpResourceFailure(claim, response, context);
    if (resourceFailure !== undefined) {
      return resourceFailure;
    }
    const jobContent = asRecord(artifact.content);
    const responseBody = asRecord(asRecord(response.content)?.body);
    if (
      typeof jobContent?.id !== "string" ||
      typeof responseBody?.jobId !== "string" ||
      jobContent.id !== responseBody.jobId
    ) {
      return result(claim, "NOT_PROVEN", "JOB_RESPONSE_BINDING_MISMATCH", [
        response.id,
        artifact.id
      ]);
    }
    const status = jobContent.status;
    if (status === "completed" || status === "succeeded") {
      return result(claim, "PROVEN", "JOB_REPORTED_TERMINAL_SUCCESS", [response.id, artifact.id], [
        "This establishes only what the named source reported under the declared trust context."
      ]);
    }
    if (status === "failed" || status === "cancelled") {
      return result(claim, "NOT_PROVEN", "JOB_REPORTED_TERMINAL_FAILURE", [response.id, artifact.id]);
    }
    return result(claim, "UNKNOWN", "JOB_NOT_IN_TERMINAL_STATE", [response.id, artifact.id]);
  }

  private digestValid(claim: PlanClaim, context: VerificationContext): ClaimResult {
    const ids = stringArray(claim.parameters?.artifactIds);
    const selected = ids.length === 0
      ? context.bundle.artifacts
      : ids.map(id => context.bundle.artifacts.find(artifact => artifact.id === id)).filter(isDefined);
    if (ids.length > 0 && selected.length !== ids.length) {
      return result(claim, "UNKNOWN", "SELECTED_ARTIFACT_NOT_FOUND", [], [
        `Missing artifact IDs: ${missingArtifactIds(ids, context).join(", ")}`
      ]);
    }
    if (selected.length === 0) {
      return missing(claim, "NO_ARTIFACTS_SELECTED");
    }
    const invalid = selected.filter(artifact => !context.validArtifactIds.has(artifact.id));
    return invalid.length === 0
      ? result(claim, "PROVEN", "ALL_SELECTED_DIGESTS_VALID", selected.map(artifact => artifact.id))
      : result(claim, "NOT_PROVEN", "ARTIFACT_DIGEST_MISMATCH", invalid.map(artifact => artifact.id));
  }

  private correlationMatch(claim: PlanClaim, context: VerificationContext): ClaimResult {
    const ids = stringArray(claim.parameters?.artifactIds);
    const selected = ids.length === 0
      ? context.bundle.artifacts
      : ids.map(id => context.bundle.artifacts.find(artifact => artifact.id === id)).filter(isDefined);
    if (ids.length > 0 && selected.length !== ids.length) {
      return result(claim, "UNKNOWN", "SELECTED_ARTIFACT_NOT_FOUND", [], [
        `Missing artifact IDs: ${missingArtifactIds(ids, context).join(", ")}`
      ]);
    }
    if (selected.length === 0) {
      return missing(claim, "NO_ARTIFACTS_SELECTED");
    }
    const invalid = selected.filter(artifact => !context.validArtifactIds.has(artifact.id));
    if (invalid.length > 0) {
      return result(
        claim,
        "UNKNOWN",
        "SELECTED_ARTIFACT_DIGEST_INVALID",
        invalid.map(artifact => artifact.id)
      );
    }
    const mismatch = selected.filter(
      artifact => artifact.correlation.interactionId !== context.plan.subject.interactionId
    );
    return mismatch.length === 0
      ? result(claim, "PROVEN", "INTERACTION_CORRELATION_MATCHED", selected.map(artifact => artifact.id))
      : result(claim, "NOT_PROVEN", "INTERACTION_CORRELATION_MISMATCH", mismatch.map(artifact => artifact.id));
  }

  private sourceStatementObserved(claim: PlanClaim, context: VerificationContext): ClaimResult {
    const artifact = this.usableArtifact(claim, context, "source.statement", "artifactId");
    if (artifact === undefined) {
      return missing(claim, "NO_VALID_SOURCE_STATEMENT");
    }
    const issuerFailure = this.issuerSelectionFailure(claim, artifact, "issuerId");
    if (issuerFailure !== undefined) {
      return issuerFailure;
    }
    const content = asRecord(artifact.content);
    const expectedField = claim.parameters?.field;
    const interactionField = claim.parameters?.interactionField;
    const expectedValue = claim.parameters?.equals;
    if (typeof expectedField !== "string" || typeof interactionField !== "string") {
      return result(claim, "UNKNOWN", "SOURCE_STATEMENT_PREDICATE_INCOMPLETE", [artifact.id]);
    }
    if (content?.[interactionField] !== context.plan.subject.interactionId) {
      return result(claim, "NOT_PROVEN", "SOURCE_STATEMENT_INTERACTION_MISMATCH", [artifact.id]);
    }
    const actualValue = content?.[expectedField];
    const matches = actualValue !== undefined && canonicalJson(actualValue) === canonicalJson(expectedValue);
    return matches
      ? result(claim, "PROVEN", "SOURCE_STATEMENT_MATCHED", [artifact.id], [
          "The bundle contains a matching statement attributed to this source; authentication is a separate claim.",
          "Presence does not establish that the statement is true."
        ])
      : result(claim, "NOT_PROVEN", "SOURCE_STATEMENT_MISMATCH", [artifact.id]);
  }

  private sourceAuthenticated(claim: PlanClaim, context: VerificationContext): ClaimResult {
    const artifact = this.usableArtifact(claim, context, "source.statement", "artifactId");
    if (artifact === undefined) {
      return missing(claim, "NO_VALID_SOURCE_STATEMENT");
    }
    return this.sourceAuthenticationResult(claim, artifact, context);
  }

  private sourceAuthenticationResult(
    claim: PlanClaim,
    artifact: EvidenceArtifact,
    context: VerificationContext
  ): ClaimResult {
    const issuerFailure = this.issuerSelectionFailure(claim, artifact, "issuerId");
    if (issuerFailure !== undefined) {
      return issuerFailure;
    }
    if (artifact.signature === undefined) {
      return result(claim, "UNKNOWN", "NO_SOURCE_SIGNATURE", [artifact.id]);
    }
    if (!this.trustProfileCommitted(context)) {
      return result(claim, "NOT_PROVEN", "TRUST_PROFILE_COMMITMENT_MISMATCH", [artifact.id]);
    }
    const expectedPublicKey = context.bundle.trustContext.sourcePublicKeys[artifact.issuer.id];
    if (expectedPublicKey === undefined) {
      return result(claim, "UNKNOWN", "SOURCE_KEY_NOT_BOUND_TO_ISSUER", [artifact.id], [
        "An embedded public key cannot authenticate the declared issuer without a precommitted key binding."
      ]);
    }
    if (expectedPublicKey !== artifact.signature.publicKey) {
      return result(claim, "NOT_PROVEN", "SOURCE_KEY_BINDING_MISMATCH", [artifact.id]);
    }
    return verifyJsonSignature(artifactEnvelope(artifact), artifact.signature)
      ? result(claim, "PROVEN", "ED25519_SIGNATURE_VALID", [artifact.id], [
          "A valid signature establishes integrity and control of the signing key, not truth."
        ])
      : result(claim, "NOT_PROVEN", "SOURCE_SIGNATURE_INVALID", [artifact.id]);
  }

  private sourceIndependent(claim: PlanClaim, context: VerificationContext): ClaimResult {
    const artifact = this.usableArtifact(claim, context, "source.statement", "artifactId");
    if (artifact === undefined) {
      return missing(claim, "NO_VALID_SOURCE_STATEMENT");
    }
    const authentication = this.sourceAuthenticationResult(claim, artifact, context);
    if (authentication.status !== "PROVEN") {
      return authentication;
    }
    if (!this.trustProfileCommitted(context)) {
      return result(claim, "NOT_PROVEN", "TRUST_PROFILE_COMMITMENT_MISMATCH", [artifact.id]);
    }
    if (artifact.issuer.controller === "PROVIDER" || artifact.issuer.controller === "CLIENT") {
      return result(claim, "NOT_PROVEN", "SOURCE_CONTROLLED_BY_TRANSACTION_PARTY", [artifact.id]);
    }
    if (context.bundle.trustContext.independentSources.includes(artifact.issuer.id)) {
      return result(claim, "PROVEN", "SOURCE_INDEPENDENT_UNDER_DECLARED_TRUST_PROFILE", [artifact.id], [
        "Independence is supplied by configuration; cryptography alone cannot establish institutional independence."
      ]);
    }
    return result(claim, "UNKNOWN", "SOURCE_INDEPENDENCE_NOT_ESTABLISHED", [artifact.id]);
  }

  private sourceAuthoritative(claim: PlanClaim, context: VerificationContext): ClaimResult {
    const artifact = this.usableArtifact(claim, context, "source.statement", "artifactId");
    if (artifact === undefined) {
      return missing(claim, "NO_VALID_SOURCE_STATEMENT");
    }
    const authentication = this.sourceAuthenticationResult(claim, artifact, context);
    if (authentication.status !== "PROVEN") {
      return authentication;
    }
    if (!this.trustProfileCommitted(context)) {
      return result(claim, "NOT_PROVEN", "TRUST_PROFILE_COMMITMENT_MISMATCH", [artifact.id]);
    }
    return context.bundle.trustContext.authoritativeSources.includes(artifact.issuer.id)
      ? result(claim, "PROVEN", "SOURCE_AUTHORITATIVE_UNDER_DECLARED_TRUST_PROFILE", [artifact.id], [
          "Authority is a contractual or institutional assumption, not a property of the signature."
        ])
      : result(claim, "UNKNOWN", "SOURCE_AUTHORITY_NOT_ESTABLISHED", [artifact.id]);
  }

  private responseBodyBound(claim: PlanClaim, context: VerificationContext): ClaimResult {
    const response = this.usableArtifact(claim, context, "http.response", "responseArtifactId");
    const settlement = this.usableArtifact(
      claim,
      context,
      "x402.settlement-boundary",
      "settlementArtifactId"
    );
    if (response === undefined || settlement === undefined) {
      return missing(claim, "RESPONSE_OR_SETTLEMENT_EVIDENCE_MISSING");
    }
    const responseAuthenticationFailure = this.artifactAuthenticationFailure(
      claim,
      response,
      context,
      ["LAB_FIXTURE"],
      "responseIssuerId"
    );
    if (responseAuthenticationFailure !== undefined) {
      return responseAuthenticationFailure;
    }
    const settlementAuthenticationFailure = this.artifactAuthenticationFailure(
      claim,
      settlement,
      context,
      ["PAYMENT_FACILITATOR"],
      "settlementIssuerId"
    );
    if (settlementAuthenticationFailure !== undefined) {
      return settlementAuthenticationFailure;
    }
    if (!isHttpResponseArtifact(response.content)) {
      return result(claim, "UNKNOWN", "HTTP_RESPONSE_SHAPE_INVALID", [response.id]);
    }
    const resourceFailure = this.httpResourceFailure(claim, response, context);
    if (resourceFailure !== undefined) {
      return resourceFailure;
    }
    const settlementContent = asRecord(settlement.content);
    const committedDigest = settlementContent?.responseBodyDigest;
    const responseContent = asRecord(response.content);
    if (typeof committedDigest !== "string" || responseContent === undefined) {
      return result(claim, "UNKNOWN", "PAYMENT_RECEIPT_HAS_NO_RESPONSE_BODY_BINDING", [
        response.id,
        settlement.id
      ]);
    }
    if (settlementContent?.success !== true) {
      return result(claim, "NOT_PROVEN", "SETTLEMENT_BOUNDARY_NOT_SUCCESSFUL", [
        response.id,
        settlement.id
      ]);
    }
    const observedBodyDigest = sha256(responseContent.body);
    return committedDigest === observedBodyDigest
      ? result(claim, "PROVEN", "RESPONSE_BODY_DIGEST_BOUND_TO_SETTLEMENT", [response.id, settlement.id])
      : result(claim, "NOT_PROVEN", "RESPONSE_BODY_BINDING_MISMATCH", [response.id, settlement.id]);
  }

  private usableArtifact(
    claim: PlanClaim,
    context: VerificationContext,
    fallbackKind: string,
    parameterName = "artifactId"
  ): EvidenceArtifact | undefined {
    const artifact = findArtifact(
      context.bundle.artifacts,
      claim.parameters?.[parameterName],
      fallbackKind
    );
    if (artifact === undefined || !context.validArtifactIds.has(artifact.id)) {
      return undefined;
    }
    if (artifact.correlation.interactionId !== context.plan.subject.interactionId) {
      return undefined;
    }
    if (
      artifact.expiresAt !== undefined &&
      Date.parse(artifact.expiresAt) <= context.evaluationTime.getTime()
    ) {
      return undefined;
    }
    return artifact;
  }

  private trustProfileCommitted(context: VerificationContext): boolean {
    return context.plan.trustProfileDigest === sha256(context.bundle.trustContext);
  }

  private artifactAuthenticationFailure(
    claim: PlanClaim,
    artifact: EvidenceArtifact,
    context: VerificationContext,
    expectedRoles: readonly IssuerRole[],
    issuerParameterName: string
  ): ClaimResult | undefined {
    const issuerFailure = this.issuerSelectionFailure(claim, artifact, issuerParameterName);
    if (issuerFailure !== undefined) {
      return issuerFailure;
    }
    if (!expectedRoles.includes(artifact.issuer.role)) {
      return result(claim, "NOT_PROVEN", "ARTIFACT_ISSUER_ROLE_MISMATCH", [artifact.id]);
    }
    if (!this.trustProfileCommitted(context)) {
      return result(claim, "NOT_PROVEN", "TRUST_PROFILE_COMMITMENT_MISMATCH", [artifact.id]);
    }
    if (artifact.signature === undefined) {
      return result(claim, "UNKNOWN", "NO_ARTIFACT_SIGNATURE", [artifact.id]);
    }
    const expectedPublicKey = context.bundle.trustContext.sourcePublicKeys[artifact.issuer.id];
    if (expectedPublicKey === undefined) {
      return result(claim, "UNKNOWN", "ARTIFACT_KEY_NOT_BOUND_TO_ISSUER", [artifact.id]);
    }
    if (expectedPublicKey !== artifact.signature.publicKey) {
      return result(claim, "NOT_PROVEN", "ARTIFACT_KEY_BINDING_MISMATCH", [artifact.id]);
    }
    if (!verifyJsonSignature(artifactEnvelope(artifact), artifact.signature)) {
      return result(claim, "NOT_PROVEN", "ARTIFACT_SIGNATURE_INVALID", [artifact.id]);
    }
    return undefined;
  }

  private issuerSelectionFailure(
    claim: PlanClaim,
    artifact: EvidenceArtifact,
    issuerParameterName: string
  ): ClaimResult | undefined {
    const expectedIssuerId = claim.parameters?.[issuerParameterName];
    if (typeof expectedIssuerId !== "string") {
      return result(claim, "UNKNOWN", "ARTIFACT_ISSUER_PREDICATE_INCOMPLETE", [artifact.id]);
    }
    return artifact.issuer.id === expectedIssuerId
      ? undefined
      : result(claim, "NOT_PROVEN", "ARTIFACT_ISSUER_MISMATCH", [artifact.id]);
  }

  private httpResourceFailure(
    claim: PlanClaim,
    artifact: EvidenceArtifact,
    context: VerificationContext
  ): ClaimResult | undefined {
    const resourceUrl = asRecord(artifact.content)?.resourceUrl;
    if (typeof resourceUrl !== "string") {
      return result(claim, "UNKNOWN", "HTTP_RESOURCE_BINDING_MISSING", [artifact.id]);
    }
    return resourceUrl === context.plan.subject.resource
      ? undefined
      : result(claim, "NOT_PROVEN", "HTTP_RESOURCE_MISMATCH", [artifact.id]);
  }
}

function createAjv(): AjvLike {
  const instance = new AjvConstructor({ allErrors: true, strict: true });
  installFormats(instance);
  return instance;
}

function result(
  claim: PlanClaim,
  status: ClaimStatus,
  reasonCode: string,
  evidence: string[],
  limitations: string[] = []
): ClaimResult {
  return { id: claim.id, type: claim.type, status, reasonCode, evidence, limitations };
}

function missing(claim: PlanClaim, reasonCode: string): ClaimResult {
  return result(claim, "UNKNOWN", reasonCode, []);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function isJsonSchema(value: unknown): value is Record<string, unknown> {
  return asRecord(value) !== undefined;
}

function isHttpResponseArtifact(
  value: unknown
): value is { status: number; headers: Record<string, unknown>; body: unknown } {
  const record = asRecord(value);
  return record !== undefined &&
    Number.isInteger(record.status) &&
    (record.status as number) >= 100 &&
    (record.status as number) <= 599 &&
    asRecord(record.headers) !== undefined &&
    Object.hasOwn(record, "body");
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function missingArtifactIds(ids: string[], context: VerificationContext): string[] {
  return ids.filter(id => !context.bundle.artifacts.some(artifact => artifact.id === id));
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function formatAjvErrors(errors: ErrorObject[] | null | undefined): string[] {
  return (errors ?? []).slice(0, 8).map(error => {
    const location = error.instancePath.length === 0 ? "/" : error.instancePath;
    return `${location}: ${error.message ?? error.keyword}`;
  });
}
