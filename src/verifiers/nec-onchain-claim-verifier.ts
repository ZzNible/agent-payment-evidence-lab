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
 * - NEC verdicts preserve their epistemic weight. SUPPORTED continues
 *   evaluation toward PROVEN; CONTRADICTED yields NOT_PROVEN; INSUFFICIENT,
 *   AMBIGUOUS, and unevaluable dimensions yield UNKNOWN. A bounded outcome
 *   such as OP_ANCESTRY_DEPTH_EXCEEDED means the frozen resolver could not
 *   establish the required ancestry within its ruleset; it MUST NOT become
 *   a claim that the block is not finalized.
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

/**
 * APEL-specific evidence envelope kind carrying frozen NEC public evaluator
 * outputs. This is NOT a native NEC core NetworkEvidenceResult wire
 * artifact; it is an integration envelope owned by APEL.
 */
const NEC_EVIDENCE_ARTIFACT_KIND = "apel.nec-network-evidence.v1";

/** Standing NEC non-claim that must survive into every accepted artifact. */
const WITHDRAWAL_FINALIZATION_NOT_EVALUATED = "WITHDRAWAL_FINALIZATION_NOT_EVALUATED";

/** keccak256("Transfer(address,address,uint256)") — pinned constant. */
const ERC20_TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

/**
 * Structural patterns mirrored exactly from the FROZEN @nec/adapter-x402
 * x402-v0.1-freeze interpreter (packages/adapter-x402/src/interpret.ts).
 * This local re-derivation must never be more permissive than that freeze.
 */
const WORD32_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const CANONICAL_DECIMAL_PATTERN = /^[0-9]+$/;
const HEX_QUANTITY_PATTERN = /^0x[0-9a-f]+$/;

export interface NecPaymentExpectation {
  readonly network: string;
  readonly asset: string;
  readonly payer: string;
  readonly payTo: string;
  readonly amount: string;
  readonly transactionHash: string;
}

interface NecEvidenceContent {
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

type TransferParse =
  | { readonly kind: "candidate"; readonly candidate: TransferCandidate }
  | { readonly kind: "unrelated" }
  | { readonly kind: "excluded" };

interface DimensionObservation {
  readonly applicability: unknown;
  readonly verdict: unknown;
}

type EvmDimensionName = "execution" | "dataBinding";

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
    const content = this.necContent(artifact);
    if (typeof content === "string") {
      return result(claim, "UNKNOWN", content, [artifact.id]);
    }

    const correlationFailure = this.correlationFailure(claim, content, expectation);
    if (correlationFailure !== undefined) {
      return correlationFailure;
    }
    const dimensionFailure =
      this.dimensionFailure(claim, content, "execution") ??
      this.dimensionFailure(claim, content, "dataBinding") ??
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
  private necContent(artifact: EvidenceArtifact): NecEvidenceContent | string {
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
      !Array.isArray(evmEvaluation.observedEffects) ||
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
    return { evmEvaluation, opStackFinalityEvaluation };
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

  private evmDimensionObservation(
    evaluation: Record<string, unknown>,
    name: EvmDimensionName
  ): DimensionObservation {
    const dimensions = asRecord(evaluation.dimensions);
    const entry =
      name === "execution"
        ? asRecord(dimensions?.execution)
        : asRecord(dimensions?.dataBinding);
    const dimension = asRecord(entry?.dimension);
    return { applicability: dimension?.applicability, verdict: dimension?.verdict };
  }

  private finalityDimensionObservation(
    evaluation: Record<string, unknown>
  ): DimensionObservation {
    const wrapper = asRecord(evaluation.dimension);
    const dimension = asRecord(wrapper?.dimension);
    return { applicability: dimension?.applicability, verdict: dimension?.verdict };
  }

  /**
   * Preserves the epistemic weight of the frozen NEC verdict instead of
   * flattening every non-supported outcome into NOT_PROVEN.
   */
  private dimensionFailure(
    claim: PlanClaim,
    content: NecEvidenceContent,
    name: "execution" | "dataBinding"
  ): ClaimResult | undefined {
    const { applicability, verdict } = this.evmDimensionObservation(content.evmEvaluation, name);
    if (applicability !== "applicable") {
      return result(claim, "UNKNOWN", "NEC_DIMENSION_NOT_EVALUATED", [], [
        "The frozen NEC evaluator did not establish this dimension for the subject, so the claim cannot be established or rejected."
      ]);
    }
    if (verdict === "supported") {
      return undefined;
    }
    if (verdict === "contradicted") {
      return result(claim, "NOT_PROVEN", `${name === "execution" ? "NEC_EXECUTION" : "NEC_DATABINDING"}_CONTRADICTED`, [], [
        name === "execution"
          ? "Valid source evidence shows the subject transaction did not execute successfully, so the payment effect cannot have occurred as pre-committed."
          : "Valid source evidence contradicts the binding between the acquired receipt and the pre-committed subject transaction."
      ]);
    }
    if (verdict === "insufficient") {
      return result(claim, "UNKNOWN", `${name === "execution" ? "NEC_EXECUTION" : "NEC_DATABINDING"}_INSUFFICIENT`, [], [
        "The frozen NEC resolver could not establish this dimension within its bounded ruleset; this is not a negative assertion about the subject."
      ]);
    }
    if (verdict === "ambiguous") {
      return result(claim, "UNKNOWN", `${name === "execution" ? "NEC_EXECUTION" : "NEC_DATABINDING"}_AMBIGUOUS`, [], [
        "NEC reported an ambiguous observation for this dimension; the proposition cannot be established or rejected."
      ]);
    }
    return result(claim, "UNKNOWN", "UNSUPPORTED_NEC_EVIDENCE_PROFILE");
  }

  private finalityFailure(claim: PlanClaim, content: NecEvidenceContent): ClaimResult | undefined {
    const { applicability, verdict } = this.finalityDimensionObservation(
      content.opStackFinalityEvaluation
    );
    if (applicability !== "applicable") {
      return result(claim, "UNKNOWN", "NEC_FINALITY_NOT_EVALUATED", [], [
        "The frozen NEC evaluator did not establish finality for the subject, so the claim cannot be established or rejected."
      ]);
    }
    if (verdict === "supported") {
      return undefined;
    }
    if (verdict === "contradicted") {
      return result(claim, "NOT_PROVEN", "NEC_FINALITY_CONTRADICTED", [], [
        "Valid source evidence shows the pinned-ruleset finality conditions fail (for example a canonical-block mismatch), so D_narrow is not satisfied.",
        "This remains an L2 block-finality outcome only; it says nothing about withdrawal finalization."
      ]);
    }
    if (verdict === "insufficient") {
      return result(claim, "UNKNOWN", "NEC_FINALITY_INSUFFICIENT", [], [
        "The frozen NEC resolver could not establish the required finalized-head ancestry within its bounded ruleset (for example OP_ANCESTRY_DEPTH_EXCEEDED); this does NOT assert that the block is not finalized.",
        "This remains an L2 block-finality outcome only; it says nothing about withdrawal finalization."
      ]);
    }
    if (verdict === "ambiguous") {
      return result(claim, "UNKNOWN", "NEC_FINALITY_AMBIGUOUS", [], [
        "NEC reported an ambiguous finality observation (for example a broken ancestry chain or unstable finalized head); finalization can be neither established nor rejected.",
        "This remains an L2 block-finality outcome only; it says nothing about withdrawal finalization."
      ]);
    }
    return result(claim, "UNKNOWN", "UNSUPPORTED_NEC_EVIDENCE_PROFILE");
  }

  /**
   * Independent re-derivation of the ERC-20 Transfer correlation from the
   * artifact's raw observed log fields against the pre-committed terms,
   * using the frozen-rule structural parser below.
   */
  private paymentEffectFailure(
    claim: PlanClaim,
    content: NecEvidenceContent,
    expectation: NecPaymentExpectation
  ): ClaimResult | undefined {
    const effects = content.evmEvaluation.observedEffects as unknown[];
    const candidates: TransferCandidate[] = [];
    let excludedTransfers = 0;
    for (const effect of effects) {
      const parsed = parseTransferEffect(effect);
      if (parsed.kind === "candidate") {
        candidates.push(parsed.candidate);
      } else if (parsed.kind === "excluded") {
        excludedTransfers += 1;
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
    const matching = candidates.filter(
      candidate =>
        sameAddress(candidate.asset, expectation.asset) &&
        sameAddress(candidate.from, expectation.payer) &&
        sameAddress(candidate.to, expectation.payTo) &&
        amountsEqual(candidate.amount, expectation.amount)
    );
    if (matching.length === 1) {
      return undefined;
    }
    if (excludedTransfers > 0) {
      // Transfer-shaped observations exist but at least one failed the
      // frozen structural rules: the surviving candidates cannot establish
      // OR reject the pre-committed effect beyond the evidence boundary.
      // Malformed evidence is NOT valid negative evidence.
      return result(claim, "UNKNOWN", "NEC_PAYMENT_EFFECT_UNUSABLE", [], [
        "Transfer-shaped observations failed the frozen structural rules (fields record shape, removed flag, topic layout, padding, or field shapes) and cannot back either side of the predicate."
      ]);
    }
    if (candidates.length > 0 || matching.length > 1) {
      return result(claim, "NOT_PROVEN", "NEC_PAYMENT_EFFECT_MISMATCH", [], [
        "Observed transfer effects do not exactly match the pre-committed network, asset, payer, payTo, and amount."
      ]);
    }
    return result(claim, "NOT_PROVEN", "NEC_PAYMENT_EFFECT_NOT_OBSERVED", []);
  }
}

/**
 * Local structural classification of one generic observed effect, mirroring
 * the FROZEN @nec/adapter-x402 x402-v0.1-freeze interpreter exactly. It must
 * never be more permissive than that freeze: an effect whose fields are not a
 * plain record, or whose removed flag is not boolean, violates the generic
 * log-observation contract and is EXCLUDED; a log claiming the Transfer
 * topic0 that violates any remaining structural rule is EXCLUDED (never
 * partially interpreted), and non-Transfer logs are unrelated.
 */
function parseTransferEffect(effect: unknown): TransferParse {
  const record = asRecord(effect);
  const fields = asRecord(record?.fields);
  if (record === undefined || fields === undefined) {
    return { kind: "excluded" };
  }
  const removedRaw = fields.removed;
  if (typeof removedRaw !== "boolean") {
    return { kind: "excluded" };
  }
  const topicsRaw = fields.topics;
  if (!Array.isArray(topicsRaw) || topicsRaw.length === 0) {
    return { kind: "unrelated" };
  }
  for (let index = 0; index < topicsRaw.length; index += 1) {
    const topic: unknown = topicsRaw[index];
    if (typeof topic !== "string" || !WORD32_PATTERN.test(topic)) {
      return index === 0 ? { kind: "unrelated" } : { kind: "excluded" };
    }
  }
  const topic0 = (topicsRaw[0] as string).toLowerCase();
  if (topic0 !== ERC20_TRANSFER_TOPIC) {
    return { kind: "unrelated" };
  }
  if (removedRaw) {
    return { kind: "excluded" };
  }
  const address = fields.address;
  if (typeof address !== "string" || !ADDRESS_PATTERN.test(address)) {
    return { kind: "excluded" };
  }
  if (topicsRaw.length !== 3) {
    return { kind: "excluded" };
  }
  const data = fields.data;
  if (typeof data !== "string" || !WORD32_PATTERN.test(data)) {
    return { kind: "excluded" };
  }
  const from = decodeIndexedAddress(topicsRaw[1] as string);
  const to = decodeIndexedAddress(topicsRaw[2] as string);
  if (from === undefined || to === undefined) {
    return { kind: "excluded" };
  }
  const txHashRaw = fields.transactionHash;
  if (txHashRaw !== undefined && txHashRaw !== null) {
    if (typeof txHashRaw !== "string" || !WORD32_PATTERN.test(txHashRaw)) {
      return { kind: "excluded" };
    }
  }
  if (
    contextQuantityInvalid(fields.blockNumber) ||
    contextQuantityInvalid(fields.logIndex)
  ) {
    return { kind: "excluded" };
  }
  return {
    kind: "candidate",
    candidate: {
      effectId: typeof record.id === "string" ? record.id : "",
      asset: address.toLowerCase(),
      from,
      to,
      amount: BigInt(data.toLowerCase()).toString(10),
      transactionHash:
        typeof txHashRaw === "string" ? txHashRaw.toLowerCase() : undefined
    }
  };
}

/** Zero-padded high 12 bytes are mandatory for indexed address parameters. */
function decodeIndexedAddress(topic: string): string | undefined {
  const body = topic.toLowerCase().slice(2);
  if (body.slice(0, 24) !== "0".repeat(24)) {
    return undefined;
  }
  return `0x${body.slice(24)}`;
}

function contextQuantityInvalid(value: unknown): boolean {
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value !== "string" || value.length > 1002) {
    return true;
  }
  if (CANONICAL_DECIMAL_PATTERN.test(value)) {
    return false;
  }
  if (HEX_QUANTITY_PATTERN.test(value)) {
    const body = value.slice(2);
    return body.length > 1 && body.startsWith("0");
  }
  return true;
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
  evidence: string[] = [],
  limitations: string[] = []
): ClaimResult {
  return { id: claim.id, type: claim.type, status, reasonCode, evidence, limitations };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
