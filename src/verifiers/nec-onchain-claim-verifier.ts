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
import { sha256 } from "../security/digest.js";
import { verifyJsonSignature } from "../security/signatures.js";

/**
 * Verifier mapping NEC network evidence onto APEL's narrow D_narrow
 * proposition:
 *
 *   The payment pre-committed by the verification plan (network, asset,
 *   payer, payTo, amount) matches the observed effect of the exact executed
 *   transaction, and the containing L2 block is FINALIZED under the pinned
 *   opstack.rpc-finalized-head-v1 ruleset.
 *
 * Boundary commitments:
 *
 * - NEC remains an evidence producer. This verifier never re-derives chain
 *   state; it consumes a frozen-profile NEC evaluation artifact and maps
 *   what that artifact actually reports.
 * - Correlation comes ONLY from the plan's pre-committed payment
 *   expectation. The artifact is never allowed to supply its own expected
 *   payment terms.
 * - L2 finality under this ruleset is NOT OP Stack withdrawal
 *   finalization, L1 withdrawal claimability, or economic irreversibility.
 * - Execution/effect/finality support evaluates no economic action. No
 *   release, refund, commercial-success, or work-quality conclusion follows.
 */
const supportedClaimTypes = ["ONCHAIN_SETTLEMENT"] as const satisfies readonly ClaimType[];

/** Frozen NEC v0.1 wire/evaluation profile identifiers consumed here. */
const NEC_WIRE_PROFILE = "nec-wire-json-v1";
const NEC_CORE_SCHEMA_VERSION = "0.1";
const NEC_EVM_EVALUATION_PROFILE = "nec-resolver-evm-evaluation-v1";
const NEC_OPSTACK_EVALUATION_PROFILE = "nec-resolver-opstack-evaluation-v1";
/** Frozen OP Stack finality ruleset consumed here. */
const OPSTACK_FAMILY = "opstack";
const OPSTACK_RULESET = "opstack.rpc-finalized-head-v1";
const OPSTACK_RULESET_VERSION = "1";

/** Standing NEC non-claim that must survive into every accepted artifact. */
const WITHDRAWAL_FINALIZATION_NOT_EVALUATED = "WITHDRAWAL_FINALIZATION_NOT_EVALUATED";

const ERC20_TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const NEC_EVIDENCE_ARTIFACT_KIND = "nec.network-evidence-result";

export interface NecPaymentExpectation {
  readonly network: string;
  readonly asset: string;
  readonly payer: string;
  readonly payTo: string;
  readonly amount: string;
  readonly transactionHash: string;
}

interface NecEvidenceContent {
  wireProfile: unknown;
  coreSchemaVersion: unknown;
  evmEvaluation: Record<string, unknown>;
  opStackFinalityEvaluation: Record<string, unknown>;
}

interface TransferCandidate {
  readonly effectId: string;
  readonly asset: string;
  readonly from: string;
  readonly to: string;
  readonly amount: string;
  readonly transactionHash: string | undefined;
}

export class NecOnchainClaimVerifier implements ClaimVerifier {
  readonly claimTypes = supportedClaimTypes;

  verify(claim: PlanClaim, context: VerificationContext): ClaimResult {
    const expectation = this.expectationOf(claim);
    if (expectation === undefined) {
      return result(claim, "UNKNOWN", "NEC_ARTIFACT_SHAPE_INVALID", [], [
        "The plan's ONCHAIN_SETTLEMENT predicate is incomplete."
      ]);
    }
    const artifact = this.usableArtifact(claim, context);
    if (artifact === undefined) {
      return result(claim, "UNKNOWN", "NO_NEC_EVIDENCE_ARTIFACT", [], [
        "No valid, interaction-correlated NEC network-evidence artifact was selected."
      ]);
    }
    const authenticationFailure = this.authenticationFailure(claim, artifact, context);
    if (authenticationFailure !== undefined) {
      return authenticationFailure;
    }
    const content = this.necContent(claim, artifact);
    if (typeof content === "string") {
      return result(claim, "UNKNOWN", content, [artifact.id]);
    }

    const correlationFailure = this.correlationFailure(claim, content, expectation);
    if (correlationFailure !== undefined) {
      return correlationFailure;
    }
    const dimensionFailure =
      this.executionFailure(claim, content) ??
      this.dataBindingFailure(claim, content) ??
      this.finalityFailure(claim, content);
    if (dimensionFailure !== undefined) {
      return dimensionFailure;
    }
    const effectFailure = this.paymentEffectFailure(claim, content, expectation);
    if (effectFailure !== undefined) {
      return effectFailure;
    }
    return result(
      claim,
      "PROVEN",
      "NEC_ONCHAIN_PAYMENT_EFFECT_FINALIZED",
      [artifact.id],
      [
        "L2 finality under opstack.rpc-finalized-head-v1 is the configured source's finalized-head observation; it is NOT OP Stack withdrawal finalization, L1 withdrawal claimability, or economic irreversibility.",
        "Execution, payment-effect correlation, and finality support evaluate no economic action: no release, refund, commercial-success, work-quality, or reputation conclusion follows.",
        "The correlated payment is public network evidence used to demonstrate this integration; it was not produced by an APEL interaction.",
        "NEC observed one configured source: no cross-source consensus or independent L1 derivation is established.",
        "The payer/payTo correlation proves who moved tokens in this transaction, not that any x402 authorization or commercial obligation exists."
      ]
    );
  }

  private expectationOf(claim: PlanClaim): NecPaymentExpectation | undefined {
    const parameters = asRecord(claim.parameters);
    const payment = asRecord(parameters?.payment);
    const strings = ["network", "asset", "payer", "payTo", "amount", "transactionHash"].map(
      field => payment?.[field]
    );
    if (strings.some(value => typeof value !== "string")) {
      return undefined;
    }
    return {
      network: strings[0] as string,
      asset: strings[1] as string,
      payer: strings[2] as string,
      payTo: strings[3] as string,
      amount: strings[4] as string,
      transactionHash: strings[5] as string
    };
  }

  private usableArtifact(claim: PlanClaim, context: VerificationContext): EvidenceArtifact | undefined {
    const artifact = findArtifact(
      context.bundle.artifacts,
      claim.parameters?.artifactId,
      NEC_EVIDENCE_ARTIFACT_KIND
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

  private authenticationFailure(
    claim: PlanClaim,
    artifact: EvidenceArtifact,
    context: VerificationContext
  ): ClaimResult | undefined {
    const expectedIssuerId = claim.parameters?.issuerId;
    if (typeof expectedIssuerId !== "string") {
      return result(claim, "UNKNOWN", "ARTIFACT_ISSUER_PREDICATE_INCOMPLETE", [artifact.id]);
    }
    if (artifact.issuer.id !== expectedIssuerId) {
      return result(claim, "NOT_PROVEN", "ARTIFACT_ISSUER_MISMATCH", [artifact.id]);
    }
    const expectedRoles: readonly IssuerRole[] = ["INDEPENDENT_OBSERVER"];
    if (!expectedRoles.includes(artifact.issuer.role)) {
      return result(claim, "NOT_PROVEN", "ARTIFACT_ISSUER_ROLE_MISMATCH", [artifact.id]);
    }
    if (context.plan.trustProfileDigest !== sha256(context.bundle.trustContext)) {
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

  /** Returns the parsed NEC content, or the failing UNKNOWN reason code. */
  private necContent(claim: PlanClaim, artifact: EvidenceArtifact): NecEvidenceContent | string {
    const root = asRecord(artifact.content);
    const necEvidence = asRecord(root?.necEvidence);
    if (necEvidence === undefined) {
      return "NEC_ARTIFACT_SHAPE_INVALID";
    }
    const evmEvaluation = asRecord(necEvidence.evmEvaluation);
    const opStackFinalityEvaluation = asRecord(necEvidence.opStackFinalityEvaluation);
    if (
      necEvidence.wireProfile !== NEC_WIRE_PROFILE ||
      necEvidence.coreSchemaVersion !== NEC_CORE_SCHEMA_VERSION ||
      evmEvaluation === undefined ||
      opStackFinalityEvaluation === undefined ||
      evmEvaluation.profile !== NEC_EVM_EVALUATION_PROFILE ||
      opStackFinalityEvaluation.profile !== NEC_OPSTACK_EVALUATION_PROFILE
    ) {
      return "UNSUPPORTED_NEC_EVIDENCE_PROFILE";
    }
    const warnings = warningCodes(opStackFinalityEvaluation.warnings);
    if (!warnings.includes(WITHDRAWAL_FINALIZATION_NOT_EVALUATED)) {
      // An artifact whose producer does not carry NEC's standing withdrawal
      // non-claim claims strictly more than frozen NEC emits.
      return "UNSUPPORTED_NEC_EVIDENCE_PROFILE";
    }
    return { wireProfile: necEvidence.wireProfile, coreSchemaVersion: necEvidence.coreSchemaVersion, evmEvaluation, opStackFinalityEvaluation };
  }

  /**
   * Exact network/action/payment correlation between the pre-committed
   * expectation and BOTH halves of the artifact. Never reads expected
   * payment terms from the artifact itself.
   */
  private correlationFailure(
    claim: PlanClaim,
    content: NecEvidenceContent,
    expectation: NecPaymentExpectation
  ): ClaimResult | undefined {
    const config = asRecord(content.opStackFinalityEvaluation.config);
    if (
      config?.family !== OPSTACK_FAMILY ||
      config?.ruleset !== OPSTACK_RULESET ||
      config?.rulesetVersion !== OPSTACK_RULESET_VERSION
    ) {
      return result(claim, "UNKNOWN", "UNSUPPORTED_OPSTACK_RULESET", [], [
        `This verifier implements only ${OPSTACK_RULESET} version ${OPSTACK_RULESET_VERSION}.`
      ]);
    }
    const evmSubject = asRecord(content.evmEvaluation.subject);
    const finalitySubject = asRecord(content.opStackFinalityEvaluation.subject);
    const coherent =
      content.evmEvaluation.networkId === expectation.network &&
      content.opStackFinalityEvaluation.networkId === expectation.network &&
      config?.networkId === expectation.network &&
      evmSubject?.type === "transaction" &&
      evmSubject?.txId === expectation.transactionHash &&
      finalitySubject?.type === "transaction" &&
      finalitySubject?.txId === expectation.transactionHash;
    return coherent
      ? undefined
      : result(claim, "NOT_PROVEN", "NEC_NETWORK_OR_SUBJECT_MISMATCH", [], [
          "The artifact must describe exactly the pre-committed network and transaction on both its execution and finality halves."
        ]);
  }

  private dimensionVerdict(evaluation: Record<string, unknown>, name: string): { applicability: unknown; verdict: unknown } {
    const dimensions = asRecord(evaluation.dimensions);
    const entry = asRecord(dimensions?.[name]);
    const dimension = asRecord(entry?.dimension);
    return { applicability: dimension?.applicability, verdict: dimension?.verdict };
  }

  private singleDimensionVerdict(evaluation: Record<string, unknown>): { applicability: unknown; verdict: unknown } {
    const dimension = asRecord(asRecord(evaluation.dimension)?.dimension);
    return { applicability: dimension?.applicability, verdict: dimension?.verdict };
  }

  private executionFailure(claim: PlanClaim, content: NecEvidenceContent): ClaimResult | undefined {
    const { applicability, verdict } = this.dimensionVerdict(content.evmEvaluation, "execution");
    if (applicability === "unknown" || applicability === undefined) {
      return result(claim, "UNKNOWN", "NEC_DIMENSION_NOT_EVALUATED", []);
    }
    return verdict === "supported"
      ? undefined
      : result(claim, "NOT_PROVEN", "NEC_EXECUTION_NOT_SUPPORTED", [], [
          "A reverted or unobserved transaction cannot prove the payment effect."
        ]);
  }

  private dataBindingFailure(claim: PlanClaim, content: NecEvidenceContent): ClaimResult | undefined {
    const { applicability, verdict } = this.dimensionVerdict(content.evmEvaluation, "dataBinding");
    if (applicability === "unknown" || applicability === undefined) {
      return result(claim, "UNKNOWN", "NEC_DIMENSION_NOT_EVALUATED", []);
    }
    return verdict === "supported"
      ? undefined
      : result(claim, "NOT_PROVEN", "NEC_DATA_BINDING_NOT_SUPPORTED", []);
  }

  private finalityFailure(claim: PlanClaim, content: NecEvidenceContent): ClaimResult | undefined {
    const { applicability, verdict } = this.singleDimensionVerdict(content.opStackFinalityEvaluation);
    if (applicability === "unknown" || applicability === undefined) {
      return result(claim, "UNKNOWN", "NEC_FINALITY_NOT_EVALUATED", []);
    }
    return verdict === "supported"
      ? undefined
      : result(claim, "NOT_PROVEN", "NEC_FINALITY_NOT_SUPPORTED", [], [
          "D_narrow requires the containing L2 block to be FINALIZED; safe-but-not-finalized, depth-bounded, contradictory, or otherwise insufficient observations do not satisfy it.",
          "This remains an L2 block-finality outcome only; it says nothing about withdrawal finalization."
        ]);
  }

  /**
   * Independent re-derivation of the ERC-20 Transfer correlation from the
   * artifact's raw observed log fields against the pre-committed terms.
   */
  private paymentEffectFailure(
    claim: PlanClaim,
    content: NecEvidenceContent,
    expectation: NecPaymentExpectation
  ): ClaimResult | undefined {
    const effects = Array.isArray(content.evmEvaluation.observedEffects)
      ? content.evmEvaluation.observedEffects
      : [];
    const candidates: TransferCandidate[] = [];
    for (const effect of effects) {
      const candidate = transferCandidate(effect);
      if (candidate !== undefined) {
        candidates.push(candidate);
      }
    }
    const crossTx = candidates.find(
      candidate =>
        candidate.transactionHash !== undefined &&
        candidate.transactionHash !== expectation.transactionHash
    );
    if (crossTx !== undefined) {
      return result(claim, "NOT_PROVEN", "NEC_OBSERVED_TX_HASH_MISMATCH", [], [
        `Effect ${crossTx.effectId} cites transaction ${crossTx.transactionHash}, not the pre-committed subject.`
      ]);
    }
    const assetCandidates = candidates.filter(candidate => sameAddress(candidate.asset, expectation.asset));
    const matching = assetCandidates.filter(
      candidate =>
        sameAddress(candidate.from, expectation.payer) &&
        sameAddress(candidate.to, expectation.payTo) &&
        amountsEqual(candidate.amount, expectation.amount)
    );
    if (candidates.length === 0) {
      return result(claim, "NOT_PROVEN", "NEC_PAYMENT_EFFECT_NOT_OBSERVED", []);
    }
    return matching.length === 1
      ? undefined
      : result(claim, "NOT_PROVEN", "NEC_PAYMENT_EFFECT_MISMATCH", [], [
          "Observed transfer effects do not exactly match the pre-committed network, asset, payer, payTo, and amount."
        ]);
  }
}

function transferCandidate(effect: unknown): TransferCandidate | undefined {
  const record = asRecord(effect);
  const fields = asRecord(record?.fields);
  if (record === undefined || fields === undefined) {
    return undefined;
  }
  const topics = fields.topics;
  if (
    !Array.isArray(topics) ||
    topics.length < 3 ||
    topics[0] !== ERC20_TRANSFER_TOPIC ||
    typeof topics[1] !== "string" ||
    typeof topics[2] !== "string" ||
    typeof fields.address !== "string" ||
    typeof fields.data !== "string" ||
    fields.removed !== false
  ) {
    return undefined;
  }
  const amount = decodeAmount(fields.data);
  if (amount === undefined) {
    return undefined;
  }
  return {
    effectId: typeof record.id === "string" ? record.id : "",
    asset: fields.address,
    from: topicToAddress(topics[1]),
    to: topicToAddress(topics[2]),
    amount,
    transactionHash: typeof fields.transactionHash === "string" ? fields.transactionHash : undefined
  };
}

function decodeAmount(data: string): string | undefined {
  if (!data.startsWith("0x") || data.length < 2 || data.length > 66 || data.length % 2 !== 0) {
    return undefined;
  }
  try {
    return BigInt(data).toString(10);
  } catch {
    return undefined;
  }
}

function topicToAddress(topic: string): string {
  return `0x${topic.slice(-40)}`.toLowerCase();
}

function sameAddress(observed: string, expected: string): boolean {
  return observed.toLowerCase() === expected.toLowerCase();
}

function amountsEqual(observed: string, expected: string): boolean {
  try {
    return BigInt(observed) === BigInt(expected);
  } catch {
    return false;
  }
}

function warningCodes(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap(warning => {
    const code = asRecord(warning)?.code;
    return typeof code === "string" ? [code] : [];
  });
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

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
