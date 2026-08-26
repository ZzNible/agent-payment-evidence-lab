import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";

import type { ClaimResult, EvidenceArtifact, EvidenceBundle, VerificationReport } from "../../src/domain/types.js";
import { createArtifact } from "../../src/domain/artifacts.js";
import { analyzeEvidence } from "../../src/engine/analyze.js";
import { DocumentValidationError, validateDocument } from "../../src/engine/schema-validator.js";
import { sha256 } from "../../src/security/digest.js";
import {
  createEd25519Identity,
  exportPublicKey,
  signJson,
  type Ed25519Identity
} from "../../src/security/signatures.js";
import { MarkdownReporter } from "../../src/reporters/markdown-reporter.js";
import { CoreClaimVerifier } from "../../src/verifiers/core-claim-verifier.js";
import { NecOnchainClaimVerifier } from "../../src/verifiers/nec-onchain-claim-verifier.js";
import { FIXED_TIME, makeBundle, makePlan } from "../helpers/fixtures.js";

const FIXTURE_DIR = new URL("../fixtures/nec/", import.meta.url);

/**
 * NETWORK-VERIFIER FIXTURE provenance (real Base mainnet, single public RPC
 * source, captured through the FROZEN NEC v0.1 resolver pipelines):
 *
 * positive — tx mined just below the observed finalized head so the bounded
 *   opstack.rpc-finalized-head-v1 ancestry walk fits the frozen ceiling.
 * audited-depth-exceeded — the previously audited candidate tx whose
 *   finalized->subject depth exceeds the frozen 10,000-block ceiling by
 *   capture time: authentic finality-insufficient evidence.
 *
 * These public payments were NOT produced by APEL; they demonstrate the
 * integration only. See docs/nec-phase-b-integration.md.
 */
const POSITIVE = {
  txHash: "0x26691412a743c61a7cd775c08b218ca9189c0dd536bad61636f04d8cb0e5e627",
  blockNumber: "50471753",
  network: "eip155:8453",
  asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  payer: "0x8f6272112c3b71474f6e24a8ad0be3b253123474",
  payTo: "0x3c4384f3664b37a3cb5a5cb3452b4b4a3aa1256f",
  amount: "27146486"
};

const AUDITED_DEPTH_EXCEEDED = {
  txHash: "0x16ffd11680eb81e334d8865d60969480861792a1089dbde4781726c777edd731",
  blockNumber: "50455056",
  network: "eip155:8453",
  asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  payer: "0xc681c439995394f83d2e5b24dd75f0437815b492",
  payTo: "0x1d7f97d26ae2c01f9b01fc252b73cf0db3397e95",
  amount: "4140000"
};

const ISSUER_ID = "nec-network-verifier";
const ARTIFACT_ID = "nec-evidence-positive";
const INTERACTION_ID = "interaction-1";

interface NecFixtures {
  positiveContent: Record<string, unknown>;
  auditedContent: Record<string, unknown>;
}

let identity: Ed25519Identity;
let trustPublicKey: string;
let fixtures: NecFixtures;

beforeAll(async () => {
  await verifyManifest();
  const [positive, audited] = await Promise.all([
    readJson("nec-positive.artifact-content.json"),
    readJson("nec-audited-depth-exceeded.artifact-content.json")
  ]);
  fixtures = { positiveContent: positive, auditedContent: audited };
});

beforeEach(() => {
  identity = createEd25519Identity();
  trustPublicKey = exportPublicKey(identity);
  // ZERO-NETWORK REPLAY: every evaluation below runs with global network
  // I/O poisoned. The committed artifacts are consumed as frozen bytes.
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("NETWORK POISONED: no live dependency allowed")))
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function readJson(name: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(new URL(name, FIXTURE_DIR), "utf8")) as Record<string, unknown>;
}

/** Verify the committed MANIFEST.sha256 before any replay touches bytes. */
async function verifyManifest(): Promise<void> {
  const manifest = await readFile(new URL("MANIFEST.sha256", FIXTURE_DIR), "utf8");
  const entries = manifest
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.length > 0);
  expect(entries.length).toBeGreaterThanOrEqual(6);
  for (const entry of entries) {
    const [expectedDigest, name] = entry.split(/\s+/) as [string, string];
    const bytes = await readFile(new URL(name, FIXTURE_DIR));
    const actualDigest = createHash("sha256").update(bytes).digest("hex");
    expect(`${name}: ${actualDigest}`).toBe(`${name}: ${expectedDigest}`);
  }
}

function trustContext() {
  return {
    authoritativeSources: [],
    independentSources: [],
    sourcePublicKeys: { [ISSUER_ID]: trustPublicKey },
    declaredAssumptions: [
      "The NEC network-evidence artifact was produced by frozen NEC v0.1 resolver pipelines over raw captured RPC responses.",
      "NEC reports only what one configured network source independently supports; execution/effect/finality support is not economicAction."
    ]
  };
}

function necArtifact(content: Record<string, unknown>, overrides?: { id?: string; interactionId?: string; issuerRole?: "INDEPENDENT_OBSERVER" | "LAB_FIXTURE" | "CLIENT"; capturedAt?: string }): EvidenceArtifact {
  return createArtifact({
    id: overrides?.id ?? ARTIFACT_ID,
    kind: "apel.nec-network-evidence.v1",
    capturedAt: overrides?.capturedAt ?? FIXED_TIME,
    issuerId: ISSUER_ID,
    issuerRole: overrides?.issuerRole ?? "INDEPENDENT_OBSERVER",
    controller: "THIRD_PARTY",
    interactionId: overrides?.interactionId ?? INTERACTION_ID,
    content,
    signer: envelope => signJson(envelope, identity)
  });
}

function paymentExpectation(subject: typeof POSITIVE | typeof AUDITED_DEPTH_EXCEEDED) {
  return {
    network: subject.network,
    asset: subject.asset,
    payer: subject.payer,
    payTo: subject.payTo,
    amount: subject.amount,
    transactionHash: subject.txHash
  };
}

function onchainClaim(artifactId: string, expectation: ReturnType<typeof paymentExpectation>) {
  return {
    id: "onchain-settlement",
    type: "ONCHAIN_SETTLEMENT" as const,
    parameters: { artifactId, issuerId: ISSUER_ID, payment: expectation }
  };
}

interface RunResult {
  report: VerificationReport;
  result: ClaimResult;
  bundle: EvidenceBundle;
}

async function run(options: {
  content: Record<string, unknown>;
  expectation?: ReturnType<typeof paymentExpectation>;
  artifactOverrides?: Parameters<typeof necArtifact>[1];
  claim?: ReturnType<typeof onchainClaim>;
  omitNecVerifier?: boolean;
}): Promise<RunResult> {
  const artifact = necArtifact(options.content, options.artifactOverrides);
  const trust = trustContext();
  const claim =
    options.claim ??
    onchainClaim(ARTIFACT_ID, options.expectation ?? paymentExpectation(POSITIVE));
  const plan = makePlan([claim], INTERACTION_ID, trust);
  const bundle = makeBundle([artifact], INTERACTION_ID, trust);
  const verifiers = options.omitNecVerifier
    ? [new CoreClaimVerifier()]
    : [new CoreClaimVerifier(), new NecOnchainClaimVerifier()];
  const report = await analyzeEvidence(plan, bundle, {
    now: () => new Date(FIXED_TIME),
    verifiers
  });
  const result = report.claims.find(entry => entry.id === claim.id);
  if (result === undefined) {
    throw new Error("claim result missing");
  }
  return { report, result, bundle };
}

/** Assert the whole-report economic boundary holds. */
function expectNoEconomicAction(report: VerificationReport): void {
  expect(report.economicAction).toBe("NOT_EVALUATED");
  expect(report.disclaimerCode).toBe("EVIDENCE_ANALYSIS_ONLY");
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Replace one frozen NEC evaluator dimension with a model-permitted variant. */
function mutateDimension(
  half: "evm" | "finality",
  name: "execution" | "dataBinding",
  dimension: Record<string, unknown>
): Record<string, unknown> {
  const content = deepClone(fixtures.positiveContent);
  const nec = content.necEvidence as Record<string, unknown>;
  if (half === "finality") {
    throw new Error("use mutateFinality for finality variants");
  }
  const evm = nec.evmEvaluation as Record<string, unknown>;
  const dimensions = evm.dimensions as Record<string, unknown>;
  (dimensions[name] as Record<string, unknown>).dimension = dimension;
  return content;
}

describe("committed NEC fixture bytes", () => {
  it("pin every file listed in MANIFEST.sha256 before any replay", async () => {
    await expect(verifyManifest()).resolves.toBeUndefined();
  });

  it("carry frozen producer profiles and the standing withdrawal non-claim", () => {
    for (const label of ["positive", "audited"]) {
      const content = label === "positive" ? fixtures.positiveContent : fixtures.auditedContent;
      const nec = content.necEvidence as Record<string, unknown>;
      expect(nec.wireProfile).toBe("nec-wire-json-v1");
      expect(nec.coreSchemaVersion).toBe("0.1");
      const evm = nec.evmEvaluation as Record<string, unknown>;
      const fin = nec.opStackFinalityEvaluation as Record<string, unknown>;
      expect(evm.profile).toBe("nec-resolver-evm-evaluation-v1");
      expect(fin.profile).toBe("nec-resolver-opstack-evaluation-v1");
      const warnings = (fin.warnings as Array<{ code: string }>).map(warning => warning.code);
      expect(warnings).toContain("WITHDRAWAL_FINALIZATION_NOT_EVALUATED");
    }
  });
});

describe("positive: D_narrow satisfied by real finalized network evidence", () => {
  it("proves ONCHAIN_SETTLEMENT with NEC_ONCHAIN_PAYMENT_EFFECT_FINALIZED", async () => {
    const { report, result } = await run({ content: fixtures.positiveContent });
    expect(result.status).toBe("PROVEN");
    expect(result.reasonCode).toBe("NEC_ONCHAIN_PAYMENT_EFFECT_FINALIZED");
    expect(result.evidence).toEqual([ARTIFACT_ID]);
    expect(result.limitations.join(" ")).toContain("withdrawal finalization");
    expect(result.limitations.join(" ")).toContain("no economic action");
    expect(report.summary.proven).toBe(1);
    expectNoEconomicAction(report);
  });

  it("emits a schema-valid report whose new compatibility tuples AJV accepts", async () => {
    const artifact = necArtifact(fixtures.positiveContent);
    const trust = trustContext();
    const plan = makePlan([onchainClaim(ARTIFACT_ID, paymentExpectation(POSITIVE))], INTERACTION_ID, trust);
    const bundle = makeBundle([artifact], INTERACTION_ID, trust);
    const report = await analyzeEvidence(plan, bundle, {
      now: () => new Date(FIXED_TIME),
      verifiers: [new CoreClaimVerifier(), new NecOnchainClaimVerifier()]
    });
    await expect(validateDocument("report", report)).resolves.toBeUndefined();
    const markdown = new MarkdownReporter().render(report, { scenario: "nec-phase-b", plan, bundle, report, trace: [] });
    expect(markdown).toContain("NEC_ONCHAIN_PAYMENT_EFFECT_FINALIZED");
    expectNoEconomicAction(report);

    // The old tuple set stays closed: forging the legacy impossible combo
    // still fails validation.
    const forged = deepClone(report);
    const forgedClaim: ClaimResult = {
      id: "forged",
      type: "OBLIGATION_FULFILLED",
      status: "PROVEN",
      reasonCode: "JSON_SCHEMA_MATCH",
      evidence: ["artifact-1"],
      limitations: []
    };
    forged.claims = [forgedClaim];
    await expect(validateDocument("report", forged)).rejects.toThrow(DocumentValidationError);
  });
});

describe("negative effects: exact pre-committed terms are enforced", () => {
  const cases: Array<[string, Record<string, string>]> = [
    ["wrong recipient", { payTo: "0x0000000000000000000000000000000000000000" }],
    ["wrong payer", { payer: "0x0000000000000000000000000000000000000000" }],
    ["wrong amount", { amount: "27146487" }],
    ["wrong asset", { asset: "0x9126236476efba9ad8ab77855c60eb5bf37586eb" }]
  ];

  for (const [label, mutation] of cases) {
    it(`rejects a ${label} in the pre-committed payment`, async () => {
      const expectation = { ...paymentExpectation(POSITIVE), ...mutation };
      const { report, result } = await run({
        content: fixtures.positiveContent,
        claim: onchainClaim(ARTIFACT_ID, expectation)
      });
      expect(result.status).toBe("NOT_PROVEN");
      expect(result.reasonCode).toBe("NEC_PAYMENT_EFFECT_MISMATCH");
      expectNoEconomicAction(report);
    });
  }

  it("rejects when no transfer-shaped effect exists at all", async () => {
    const content = deepClone(fixtures.positiveContent);
    const evm = (content.necEvidence as Record<string, unknown>).evmEvaluation as Record<string, unknown>;
    evm.observedEffects = [];
    const { report, result } = await run({ content });
    expect(result.status).toBe("NOT_PROVEN");
    expect(result.reasonCode).toBe("NEC_PAYMENT_EFFECT_NOT_OBSERVED");
    expectNoEconomicAction(report);
  });

  it("rejects an effect citing a different transaction than the pre-committed subject", async () => {
    const content = deepClone(fixtures.positiveContent);
    const evm = (content.necEvidence as Record<string, unknown>).evmEvaluation as Record<string, unknown>;
    const effects = deepClone(evm.observedEffects) as Array<Record<string, unknown>>;
    const last = effects[effects.length - 1];
    if (last === undefined) {
      throw new Error("fixture has no effects");
    }
    const foreign = deepClone(last);
    (foreign.fields as Record<string, unknown>).transactionHash = AUDITED_DEPTH_EXCEEDED.txHash;
    foreign.id = "evm-log-foreign";
    evm.observedEffects = [...effects, foreign];
    const { report, result } = await run({ content });
    expect(result.status).toBe("NOT_PROVEN");
    expect(result.reasonCode).toBe("NEC_OBSERVED_TX_HASH_MISMATCH");
    expectNoEconomicAction(report);
  });
});

describe("execution mapping under the frozen verdict vocabulary", () => {
  it("maps a contradicted execution dimension to NOT_PROVEN", async () => {
    // Model-permitted variant of the real positive artifact: this mutates
    // what the (frozen) NEC evaluator WOULD emit for a reverted receipt.
    // NEC's own revert detection is covered by its frozen upstream suite.
    const content = mutateDimension("evm", "execution", {
      applicability: "applicable",
      verdict: "contradicted",
      basis: ["source_observation"],
      evidence: ["evm-receipt-fb680322d5fd0d3b"],
      reason: "variant: reverted status"
    });
    const { report, result } = await run({ content });
    expect(result.status).toBe("NOT_PROVEN");
    expect(result.reasonCode).toBe("NEC_EXECUTION_CONTRADICTED");
    expectNoEconomicAction(report);
  });

  it("maps an insufficient execution dimension to UNKNOWN, never NOT_PROVEN", async () => {
    const content = mutateDimension("evm", "execution", {
      applicability: "applicable",
      verdict: "insufficient",
      basis: ["source_observation"],
      evidence: [],
      reason: "variant: bounded observation could not establish execution"
    });
    const { report, result } = await run({ content });
    expect(result.status).toBe("UNKNOWN");
    expect(result.reasonCode).toBe("NEC_EXECUTION_INSUFFICIENT");
    expect(result.limitations.join(" ")).toContain("bounded ruleset");
    expectNoEconomicAction(report);
  });

  it("maps an ambiguous execution dimension to UNKNOWN", async () => {
    const content = mutateDimension("evm", "execution", {
      applicability: "applicable",
      verdict: "ambiguous",
      basis: ["source_observation"],
      evidence: [],
      reason: "variant: conflicting source observations"
    });
    const { report, result } = await run({ content });
    expect(result.status).toBe("UNKNOWN");
    expect(result.reasonCode).toBe("NEC_EXECUTION_AMBIGUOUS");
    expectNoEconomicAction(report);
  });

  it("reports UNKNOWN when the execution dimension was not evaluated", async () => {
    const content = mutateDimension("evm", "execution", {
      applicability: "unknown",
      basis: [],
      evidence: []
    });
    const { report, result } = await run({ content });
    expect(result.status).toBe("UNKNOWN");
    expect(result.reasonCode).toBe("NEC_DIMENSION_NOT_EVALUATED");
    expectNoEconomicAction(report);
  });
});

describe("dataBinding mapping under the frozen verdict vocabulary", () => {
  it("keeps evaluation running when dataBinding is supported", async () => {
    const { result } = await run({ content: fixtures.positiveContent });
    expect(result.status).toBe("PROVEN");
  });

  it("maps a contradicted dataBinding dimension to NOT_PROVEN", async () => {
    const content = mutateDimension("evm", "dataBinding", {
      applicability: "applicable",
      verdict: "contradicted",
      basis: ["deterministic_derivation"],
      evidence: ["evm-receipt-fb680322d5fd0d3b"],
      reason: "variant: receipt binds to another subject"
    });
    const { report, result } = await run({ content });
    expect(result.status).toBe("NOT_PROVEN");
    expect(result.reasonCode).toBe("NEC_DATABINDING_CONTRADICTED");
    expectNoEconomicAction(report);
  });

  it("maps an insufficient dataBinding dimension to UNKNOWN", async () => {
    const content = mutateDimension("evm", "dataBinding", {
      applicability: "applicable",
      verdict: "insufficient",
      basis: [],
      evidence: [],
      reason: "variant: binding could not be established within bounds"
    });
    const { report, result } = await run({ content });
    expect(result.status).toBe("UNKNOWN");
    expect(result.reasonCode).toBe("NEC_DATABINDING_INSUFFICIENT");
    expectNoEconomicAction(report);
  });

  it("maps an ambiguous dataBinding dimension to UNKNOWN", async () => {
    const content = mutateDimension("evm", "dataBinding", {
      applicability: "applicable",
      verdict: "ambiguous",
      basis: [],
      evidence: [],
      reason: "variant: ambiguous receipt composition"
    });
    const { report, result } = await run({ content });
    expect(result.status).toBe("UNKNOWN");
    expect(result.reasonCode).toBe("NEC_DATABINDING_AMBIGUOUS");
    expectNoEconomicAction(report);
  });

  it("reports UNKNOWN when the dataBinding dimension was not evaluated", async () => {
    const content = mutateDimension("evm", "dataBinding", {
      applicability: "unknown",
      basis: [],
      evidence: []
    });
    const { report, result } = await run({ content });
    expect(result.status).toBe("UNKNOWN");
    expect(result.reasonCode).toBe("NEC_DIMENSION_NOT_EVALUATED");
    expectNoEconomicAction(report);
  });
});

describe("finality under the pinned OP Stack ruleset", () => {
  it("maps the real audited depth-exceeded fixture to UNKNOWN, never NOT_PROVEN", async () => {
    const { report, result } = await run({
      content: fixtures.auditedContent,
      claim: onchainClaim(ARTIFACT_ID, paymentExpectation(AUDITED_DEPTH_EXCEEDED))
    });
    expect(result.status).toBe("UNKNOWN");
    expect(result.reasonCode).toBe("NEC_FINALITY_INSUFFICIENT");
    expect(result.limitations.join(" ")).toContain("OP_ANCESTRY_DEPTH_EXCEEDED");
    expect(result.limitations.join(" ")).toContain("does NOT assert that the block is not finalized");
    expectNoEconomicAction(report);
  });

  it("maps insufficient finality (safe-but-not-finalized) to UNKNOWN", async () => {
    const { report, result } = await run({
      content: mutateFinality("insufficient", "OP_SAFE_BUT_NOT_FINALIZED")
    });
    expect(result.status).toBe("UNKNOWN");
    expect(result.reasonCode).toBe("NEC_FINALITY_INSUFFICIENT");
    expectNoEconomicAction(report);
  });

  it("maps ambiguous broken ancestry to UNKNOWN", async () => {
    const { report, result } = await run({
      content: mutateFinality("ambiguous", "OP_ANCESTRY_HASH_CHAIN")
    });
    expect(result.status).toBe("UNKNOWN");
    expect(result.reasonCode).toBe("NEC_FINALITY_AMBIGUOUS");
    expectNoEconomicAction(report);
  });

  it("maps contradicted canonical hash mismatch to NOT_PROVEN", async () => {
    const { report, result } = await run({
      content: mutateFinality("contradicted", "OP_SUBJECT_NOT_CANONICAL_AT_HEIGHT")
    });
    expect(result.status).toBe("NOT_PROVEN");
    expect(result.reasonCode).toBe("NEC_FINALITY_CONTRADICTED");
    expectNoEconomicAction(report);
  });

  it("maps a changing finalized head (unstable burst) to UNKNOWN", async () => {
    const { report, result } = await run({
      content: mutateFinality("ambiguous", "OP_FINALIZED_HEAD_STABLE")
    });
    expect(result.status).toBe("UNKNOWN");
    expect(result.reasonCode).toBe("NEC_FINALITY_AMBIGUOUS");
    expectNoEconomicAction(report);
  });

  it("reports UNKNOWN when finality applicability is undetermined", async () => {
    const content = deepClone(fixtures.positiveContent);
    const fin = (content.necEvidence as Record<string, unknown>)
      .opStackFinalityEvaluation as Record<string, unknown>;
    ((fin.dimension as Record<string, unknown>).dimension as Record<string, unknown>) = {
      applicability: "unknown",
      basis: []
    };
    const { report, result } = await run({ content });
    expect(result.status).toBe("UNKNOWN");
    expect(result.reasonCode).toBe("NEC_FINALITY_NOT_EVALUATED");
    expectNoEconomicAction(report);
  });

  it("fails closed on an unpinned ruleset version", async () => {
    const content = deepClone(fixtures.positiveContent);
    const fin = (content.necEvidence as Record<string, unknown>)
      .opStackFinalityEvaluation as Record<string, unknown>;
    (fin.config as Record<string, unknown>).rulesetVersion = "2";
    const { report, result } = await run({ content });
    expect(result.status).toBe("UNKNOWN");
    expect(result.reasonCode).toBe("UNSUPPORTED_OPSTACK_RULESET");
    expectNoEconomicAction(report);
  });

  function mutateFinality(verdict: string, warningCode: string): Record<string, unknown> {
    const content = deepClone(fixtures.positiveContent);
    const fin = (content.necEvidence as Record<string, unknown>)
      .opStackFinalityEvaluation as Record<string, unknown>;
    const dimensionWrapper = fin.dimension as Record<string, unknown>;
    dimensionWrapper.dimension = {
      ...(dimensionWrapper.dimension as Record<string, unknown>),
      verdict,
      reason: `test variant: ${warningCode}`
    };
    fin.conflicts = [
      ...(Array.isArray(fin.conflicts) ? (fin.conflicts as unknown[]) : []),
      {
        id: `nec-opstack-conflict:${warningCode}:test`,
        code: warningCode,
        description: "Adversarial variant constructed for verifier-mapping coverage.",
        scope: { kind: "dimension", dimension: "finality" },
        evidence: [],
        material: true
      }
    ];
    fin.warnings = [
      ...(Array.isArray(fin.warnings) ? (fin.warnings as unknown[]) : []),
      { code: warningCode, message: "Adversarial variant." }
    ];
    return content;
  }
});

describe("malformed ERC-20 structure fails closed like the frozen x402 interpreter", () => {
  const WORD = "0x1111111111111111111111111111111111111111111111111111111111111111";

  /** Mutate the pre-committed USDC Transfer effect so it is no longer usable. */
  function mutateMatchingEffect(mutate: (fields: Record<string, unknown>) => void): Record<string, unknown> {
    const content = deepClone(fixtures.positiveContent);
    const evm = (content.necEvidence as Record<string, unknown>).evmEvaluation as Record<string, unknown>;
    const effects = deepClone(evm.observedEffects) as Array<Record<string, unknown>>;
    const matching = effects.find(
      effect => (effect.fields as Record<string, unknown>).address === POSITIVE.asset
    );
    if (matching === undefined) {
      throw new Error("fixture has no matching transfer effect");
    }
    mutate(matching.fields as Record<string, unknown>);
    evm.observedEffects = effects;
    return content;
  }

  function transferTopics(fields: Record<string, unknown>): string[] {
    const topics: unknown = fields.topics;
    if (
      !Array.isArray(topics) ||
      topics.length !== 3 ||
      topics.some(topic => typeof topic !== "string")
    ) {
      throw new Error("fixture transfer must carry three string topics");
    }
    return [String(topics[0]), String(topics[1]), String(topics[2])];
  }

  const cases: Array<[string, (fields: Record<string, unknown>) => void]> = [
    ["an extra fourth topic", fields => {
      fields.topics = [...transferTopics(fields), WORD];
    }],
    ["a short topic", fields => {
      const topics = transferTopics(fields);
      topics[1] = `0x${"11".repeat(31)}`;
      fields.topics = topics;
    }],
    ["an oversized topic", fields => {
      const topics = transferTopics(fields);
      topics[1] = `0x${"11".repeat(33)}`;
      fields.topics = topics;
    }],
    ["non-zero high padding in the sender", fields => {
      const topics = transferTopics(fields);
      topics[1] = `0x01${(topics[1] ?? "0x").slice(4)}`;
      fields.topics = topics;
    }],
    ["non-zero high padding in the recipient", fields => {
      const topics = transferTopics(fields);
      topics[2] = `0x01${(topics[2] ?? "0x").slice(4)}`;
      fields.topics = topics;
    }],
    ["a short data word", fields => {
      fields.data = `0x${"22".repeat(30)}`;
    }],
    ["an oversized data word", fields => {
      fields.data = `0x${"22".repeat(33)}`;
    }],
    ["a malformed token address", fields => {
      fields.address = POSITIVE.asset.slice(0, -1);
    }],
    ["a malformed transactionHash", fields => {
      fields.transactionHash = "0x1234";
    }],
    ["removed=true", fields => {
      fields.removed = true;
    }]
  ];

  for (const [label, mutate] of cases) {
    it(`fails closed on ${label}`, async () => {
      const { report, result } = await run({ content: mutateMatchingEffect(mutate) });
      expect(result.status).toBe("UNKNOWN");
      expect(result.reasonCode).toBe("NEC_PAYMENT_EFFECT_UNUSABLE");
      expect(result.limitations.join(" ")).toContain("frozen structural rules");
      expectNoEconomicAction(report);
    });
  }

  it("keeps proving settlement when a removed orphan sits beside a valid matching transfer", async () => {
    const content = mutateMatchingEffect(fields => {
      fields.removed = true;
    });
    // A second, well-formed duplicate independently satisfies the
    // pre-committed predicate; the removed carrier cannot poison that proof.
    const evm = (content.necEvidence as Record<string, unknown>).evmEvaluation as Record<string, unknown>;
    const effects = deepClone(evm.observedEffects) as Array<Record<string, unknown>>;
    evm.observedEffects = [...effects, syntheticMatchingTransfer()];
    const { report, result } = await run({ content });
    expect(result.status).toBe("PROVEN");
    expectNoEconomicAction(report);
  });

  function syntheticMatchingTransfer(): Record<string, unknown> {
    return {
      id: "evm-log-duplicate",
      type: "log",
      basis: ["source_observation"],
      evidence: [],
      fields: {
        address: POSITIVE.asset,
        topics: [
          "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
          `0x000000000000000000000000${POSITIVE.payer.slice(2)}`,
          `0x000000000000000000000000${POSITIVE.payTo.slice(2)}`
        ],
        data: `0x${BigInt(POSITIVE.amount).toString(16).padStart(64, "0")}`,
        blockNumber: POSITIVE.blockNumber,
        transactionHash: POSITIVE.txHash,
        logIndex: "99",
        removed: false
      }
    };
  }

  it("still proves settlement when a non-transfer log carries odd but unrelated shape", async () => {
    const content = mutateMatchingEffect(() => undefined);
    const evm = (content.necEvidence as Record<string, unknown>).evmEvaluation as Record<string, unknown>;
    const unrelated = {
      id: "evm-log-unrelated",
      type: "log",
      fields: {
        address: POSITIVE.asset,
        topics: [],
        data: "0x",
        removed: true
      },
      basis: ["source_observation"],
      evidence: []
    };
    const effects = deepClone(evm.observedEffects) as Array<Record<string, unknown>>;
    evm.observedEffects = [...effects, unrelated];
    const { report, result } = await run({ content });
    expect(result.status).toBe("PROVEN");
    expectNoEconomicAction(report);
  });
});

describe("malformed evidence envelope fails closed like the frozen x402 interpreter", () => {
  /** Mutate the whole pre-committed USDC Transfer effect (fields included). */
  function mutateMatchingEffectWhole(mutate: (effect: Record<string, unknown>) => void): Record<string, unknown> {
    const content = deepClone(fixtures.positiveContent);
    const evm = (content.necEvidence as Record<string, unknown>).evmEvaluation as Record<string, unknown>;
    const effects = deepClone(evm.observedEffects) as Array<Record<string, unknown>>;
    const matching = effects.find(
      effect => ((effect.fields ?? {}) as Record<string, unknown>).address === POSITIVE.asset
    );
    if (matching === undefined) {
      throw new Error("fixture has no matching transfer effect");
    }
    mutate(matching);
    evm.observedEffects = effects;
    return content;
  }

  function stripRemoved(effect: Record<string, unknown>): Record<string, unknown> {
    const fields = { ...(effect.fields as Record<string, unknown>) };
    delete fields.removed;
    return fields;
  }

  const cases: Array<[string, (effect: Record<string, unknown>) => void]> = [
    ["fields is missing", effect => {
      delete effect.fields;
    }],
    ["fields is null", effect => {
      effect.fields = null;
    }],
    ["fields is an array", effect => {
      effect.fields = [(effect.fields as Record<string, unknown>).removed];
    }],
    ["fields is a string", effect => {
      effect.fields = "log";
    }],
    ["fields is a number", effect => {
      effect.fields = 42;
    }],
    ["removed is missing", effect => {
      effect.fields = stripRemoved(effect);
    }],
    ["removed is a string", effect => {
      effect.fields = { ...(effect.fields as Record<string, unknown>), removed: "false" };
    }],
    ["removed is a number", effect => {
      effect.fields = { ...(effect.fields as Record<string, unknown>), removed: 0 };
    }],
    ["removed is null", effect => {
      effect.fields = { ...(effect.fields as Record<string, unknown>), removed: null };
    }]
  ];

  for (const [label, mutate] of cases) {
    it(`treats an effect with ${label} as unusable, never unobserved`, async () => {
      const { report, result } = await run({ content: mutateMatchingEffectWhole(mutate) });
      expect(result.status).toBe("UNKNOWN");
      expect(result.reasonCode).toBe("NEC_PAYMENT_EFFECT_UNUSABLE");
      expectNoEconomicAction(report);
    });
  }

  it("keeps proving settlement when a non-Transfer unrelated effect sits beside a valid matching transfer", async () => {
    const content = deepClone(fixtures.positiveContent);
    const evm = (content.necEvidence as Record<string, unknown>).evmEvaluation as Record<string, unknown>;
    const effects = deepClone(evm.observedEffects) as Array<Record<string, unknown>>;
    const unrelated = {
      id: "evm-log-nontransfer-unrelated",
      type: "log",
      basis: ["source_observation"],
      evidence: [],
      fields: {
        address: POSITIVE.asset,
        topics: ["0xaa2dd386ed08cffba41a0743017e66546cc06f5cb0043db0ef5a19a329a02f56"],
        data: "0x",
        removed: false
      }
    };
    evm.observedEffects = [...effects, unrelated];
    const { report, result } = await run({ content });
    expect(result.status).toBe("PROVEN");
    expect(result.reasonCode).toBe("NEC_ONCHAIN_PAYMENT_EFFECT_FINALIZED");
    expectNoEconomicAction(report);
  });
});

describe("artifact failure handling", () => {
  it("treats a missing NEC artifact as UNKNOWN", async () => {
    const { report, result } = await run({
      content: fixtures.positiveContent,
      claim: onchainClaim("nec-evidence-absent", paymentExpectation(POSITIVE))
    });
    expect(result.status).toBe("UNKNOWN");
    expect(result.reasonCode).toBe("NO_NEC_EVIDENCE_ARTIFACT");
    expectNoEconomicAction(report);
  });

  it("treats an artifact bound to another interaction as missing", async () => {
    const { report, result } = await run({
      content: fixtures.positiveContent,
      artifactOverrides: { interactionId: "interaction-OTHER" }
    });
    expect(result.status).toBe("UNKNOWN");
    expect(result.reasonCode).toBe("NO_NEC_EVIDENCE_ARTIFACT");
    expectNoEconomicAction(report);
  });

  it("rejects a malformed artifact payload", async () => {
    const { report, result } = await run({ content: { something: "else" } });
    expect(result.status).toBe("UNKNOWN");
    expect(result.reasonCode).toBe("NEC_ARTIFACT_SHAPE_INVALID");
    expectNoEconomicAction(report);
  });

  it("detects a digest mismatch: tampered content fails bundle integrity before evaluation", async () => {
    const artifact = necArtifact(fixtures.positiveContent);
    const tampered: EvidenceArtifact = {
      ...artifact,
      content: deepClone(fixtures.auditedContent)
    };
    const trust = trustContext();
    const plan = makePlan([onchainClaim(ARTIFACT_ID, paymentExpectation(POSITIVE))], INTERACTION_ID, trust);
    const bundle = makeBundle([tampered], INTERACTION_ID, trust);
    const report = await analyzeEvidence(plan, bundle, {
      now: () => new Date(FIXED_TIME),
      verifiers: [new CoreClaimVerifier(), new NecOnchainClaimVerifier()]
    });
    const result = report.claims.find(entry => entry.id === "onchain-settlement");
    expect(result?.status).toBe("UNKNOWN");
    expect(result?.reasonCode).toBe("NO_NEC_EVIDENCE_ARTIFACT");
    expectNoEconomicAction(report);
  });

  it("fails closed on an unsupported wire profile", async () => {
    const content = deepClone(fixtures.positiveContent);
    ((content.necEvidence as Record<string, unknown>).wireProfile) = "nec-wire-json-v2";
    const { report, result } = await run({ content });
    expect(result.status).toBe("UNKNOWN");
    expect(result.reasonCode).toBe("UNSUPPORTED_NEC_EVIDENCE_PROFILE");
    expectNoEconomicAction(report);
  });

  it("fails closed on an unsupported core schema version", async () => {
    const content = deepClone(fixtures.positiveContent);
    ((content.necEvidence as Record<string, unknown>).coreSchemaVersion) = "0.2";
    const { report, result } = await run({ content });
    expect(result.status).toBe("UNKNOWN");
    expect(result.reasonCode).toBe("UNSUPPORTED_NEC_EVIDENCE_PROFILE");
    expectNoEconomicAction(report);
  });

  it("fails closed when the producer's withdrawal non-claim was stripped", async () => {
    const content = deepClone(fixtures.positiveContent);
    const fin = (content.necEvidence as Record<string, unknown>)
      .opStackFinalityEvaluation as Record<string, unknown>;
    fin.warnings = (fin.warnings as Array<{ code: string }>).filter(
      warning => warning.code !== "WITHDRAWAL_FINALIZATION_NOT_EVALUATED"
    );
    const { report, result } = await run({ content });
    expect(result.status).toBe("UNKNOWN");
    expect(result.reasonCode).toBe("UNSUPPORTED_NEC_EVIDENCE_PROFILE");
    expectNoEconomicAction(report);
  });

  it("fails closed on an unsupported NEC evaluation profile", async () => {
    const content = deepClone(fixtures.positiveContent);
    const nec = content.necEvidence as Record<string, unknown>;
    ((nec.evmEvaluation as Record<string, unknown>).profile) = "nec-resolver-evm-evaluation-v2";
    const { report, result } = await run({ content });
    expect(result.status).toBe("UNKNOWN");
    expect(result.reasonCode).toBe("UNSUPPORTED_NEC_EVIDENCE_PROFILE");
    expectNoEconomicAction(report);
  });
});

describe("correlation boundaries", () => {
  it("never lets a valid unrelated real transaction satisfy this interaction", async () => {
    const { report, result } = await run({ content: fixtures.auditedContent });
    expect(result.status).toBe("NOT_PROVEN");
    expect(result.reasonCode).toBe("NEC_NETWORK_OR_SUBJECT_MISMATCH");
    expectNoEconomicAction(report);
  });

  it("rejects a network mismatch between plan and artifact", async () => {
    const expectation = { ...paymentExpectation(POSITIVE), network: "eip155:42161" };
    const { report, result } = await run({
      content: fixtures.positiveContent,
      claim: onchainClaim(ARTIFACT_ID, expectation)
    });
    expect(result.status).toBe("NOT_PROVEN");
    expect(result.reasonCode).toBe("NEC_NETWORK_OR_SUBJECT_MISMATCH");
    expectNoEconomicAction(report);
  });

  it("rejects when the artifact halves disagree about the subject transaction", async () => {
    const content = deepClone(fixtures.positiveContent);
    const fin = (content.necEvidence as Record<string, unknown>)
      .opStackFinalityEvaluation as Record<string, unknown>;
    (fin.subject as Record<string, unknown>).txId = AUDITED_DEPTH_EXCEEDED.txHash;
    const { report, result } = await run({ content });
    expect(result.status).toBe("NOT_PROVEN");
    expect(result.reasonCode).toBe("NEC_NETWORK_OR_SUBJECT_MISMATCH");
    expectNoEconomicAction(report);
  });
});

describe("authentication and issuer selection reuse", () => {
  it("rejects a different artifact issuer than the plan selected", async () => {
    const rebuilt = createArtifact({
      id: ARTIFACT_ID,
      kind: "apel.nec-network-evidence.v1",
      capturedAt: FIXED_TIME,
      issuerId: "someone-else",
      issuerRole: "INDEPENDENT_OBSERVER",
      controller: "THIRD_PARTY",
      interactionId: INTERACTION_ID,
      content: fixtures.positiveContent,
      signer: envelope => signJson(envelope, identity)
    });
    const trust = trustContext();
    const plan = makePlan([onchainClaim(ARTIFACT_ID, paymentExpectation(POSITIVE))], INTERACTION_ID, trust);
    const bundle = makeBundle([rebuilt], INTERACTION_ID, trust);
    const report = await analyzeEvidence(plan, bundle, {
      now: () => new Date(FIXED_TIME),
      verifiers: [new NecOnchainClaimVerifier()]
    });
    const result = report.claims.find(entry => entry.id === "onchain-settlement");
    expect(result?.status).toBe("NOT_PROVEN");
    expect(result?.reasonCode).toBe("ARTIFACT_ISSUER_MISMATCH");
    expectNoEconomicAction(report);
  });

  it("rejects an issuer role that cannot observe networks independently", async () => {
    const { report, result } = await run({
      content: fixtures.positiveContent,
      artifactOverrides: { issuerRole: "CLIENT" }
    });
    expect(result.status).toBe("NOT_PROVEN");
    expect(result.reasonCode).toBe("ARTIFACT_ISSUER_ROLE_MISMATCH");
    expectNoEconomicAction(report);
  });

  it("rejects an invalid artifact signature", async () => {
    const artifact = necArtifact(fixtures.positiveContent);
    if (artifact.signature === undefined) {
      throw new Error("fixture artifact must be signed");
    }
    const forged: EvidenceArtifact = {
      ...artifact,
      signature: {
        algorithm: "Ed25519",
        publicKey: artifact.signature.publicKey,
        value: Buffer.from("forged").toString("base64")
      }
    };
    const trust = trustContext();
    const plan = makePlan([onchainClaim(ARTIFACT_ID, paymentExpectation(POSITIVE))], INTERACTION_ID, trust);
    const bundle = makeBundle([forged], INTERACTION_ID, trust);
    const report = await analyzeEvidence(plan, bundle, {
      now: () => new Date(FIXED_TIME),
      verifiers: [new NecOnchainClaimVerifier()]
    });
    const result = report.claims.find(entry => entry.id === "onchain-settlement");
    expect(result?.status).toBe("NOT_PROVEN");
    expect(result?.reasonCode).toBe("ARTIFACT_SIGNATURE_INVALID");
    expectNoEconomicAction(report);
  });
});

describe("frozen core semantics", () => {
  it("keeps the default core verifier UNKNOWN for ONCHAIN_SETTLEMENT", async () => {
    const { report, result } = await run({ content: fixtures.positiveContent, omitNecVerifier: true });
    expect(result.status).toBe("UNKNOWN");
    expect(result.reasonCode).toBe("NO_ONCHAIN_CONFIRMATION_EVIDENCE");
    expectNoEconomicAction(report);
  });

  it("binds the plan digest to the exact inputs either way", async () => {
    const trust = trustContext();
    const plan = makePlan([onchainClaim(ARTIFACT_ID, paymentExpectation(POSITIVE))], INTERACTION_ID, trust);
    const bundle = makeBundle([necArtifact(fixtures.positiveContent)], INTERACTION_ID, trust);
    expect(plan.trustProfileDigest).toBe(sha256(trust));
    expect(bundle.specVersion).toBe("apel.evidence-bundle/0.1");
  });
});

describe("real generated reports satisfy verification-report.schema.json", () => {
  /**
   * Cross-layer gate: every representative outcome below is produced by the
   * REAL verifier over real fixture bytes (not synthetic ClaimResult
   * fixtures), then validated end-to-end against the report schema.
   */
  async function expectGeneratedReportValid(options: {
    content?: Record<string, unknown>;
    claim?: ReturnType<typeof onchainClaim>;
    expectedStatus: ClaimResult["status"];
    expectedReasonCode: string;
    expectArtifactEvidence?: boolean;
  }): Promise<void> {
    const { report, result } = await run({
      content: options.content ?? fixtures.positiveContent,
      claim: options.claim
    });
    expect(result.status).toBe(options.expectedStatus);
    expect(result.reasonCode).toBe(options.expectedReasonCode);
    if (options.expectArtifactEvidence) {
      expect(result.evidence).toContain(ARTIFACT_ID);
    }
    await expect(validateDocument("report", report)).resolves.toBeUndefined();
    expectNoEconomicAction(report);
  }

  function withFinalityVerdict(verdict: string, warningCode: string): Record<string, unknown> {
    const content = deepClone(fixtures.positiveContent);
    const fin = (content.necEvidence as Record<string, unknown>)
      .opStackFinalityEvaluation as Record<string, unknown>;
    const dimensionWrapper = fin.dimension as Record<string, unknown>;
    dimensionWrapper.dimension = {
      ...(dimensionWrapper.dimension as Record<string, unknown>),
      verdict,
      reason: `test variant: ${warningCode}`
    };
    fin.warnings = [
      ...(Array.isArray(fin.warnings) ? (fin.warnings as unknown[]) : []),
      { code: warningCode, message: "Adversarial variant." }
    ];
    return content;
  }

  it("PROVEN / NEC_ONCHAIN_PAYMENT_EFFECT_FINALIZED is schema-valid", async () => {
    await expectGeneratedReportValid({
      expectedStatus: "PROVEN",
      expectedReasonCode: "NEC_ONCHAIN_PAYMENT_EFFECT_FINALIZED",
      expectArtifactEvidence: true
    });
  });

  it("NOT_PROVEN / NEC_PAYMENT_EFFECT_MISMATCH is schema-valid and cites the artifact", async () => {
    const expectation = { ...paymentExpectation(POSITIVE), amount: "27146487" };
    await expectGeneratedReportValid({
      claim: onchainClaim(ARTIFACT_ID, expectation),
      expectedStatus: "NOT_PROVEN",
      expectedReasonCode: "NEC_PAYMENT_EFFECT_MISMATCH",
      expectArtifactEvidence: true
    });
  });

  it("NOT_PROVEN / NEC_FINALITY_CONTRADICTED is schema-valid and cites the artifact", async () => {
    await expectGeneratedReportValid({
      content: withFinalityVerdict("contradicted", "OP_SUBJECT_NOT_CANONICAL_AT_HEIGHT"),
      expectedStatus: "NOT_PROVEN",
      expectedReasonCode: "NEC_FINALITY_CONTRADICTED",
      expectArtifactEvidence: true
    });
  });

  it("UNKNOWN / NEC_FINALITY_INSUFFICIENT is schema-valid", async () => {
    await expectGeneratedReportValid({
      content: fixtures.auditedContent,
      claim: onchainClaim(ARTIFACT_ID, paymentExpectation(AUDITED_DEPTH_EXCEEDED)),
      expectedStatus: "UNKNOWN",
      expectedReasonCode: "NEC_FINALITY_INSUFFICIENT"
    });
  });

  it("UNKNOWN / NEC_PAYMENT_EFFECT_UNUSABLE is schema-valid", async () => {
    const content = deepClone(fixtures.positiveContent);
    const evm = (content.necEvidence as Record<string, unknown>).evmEvaluation as Record<string, unknown>;
    const effects = deepClone(evm.observedEffects) as Array<Record<string, unknown>>;
    const matching = effects.find(
      effect => ((effect.fields ?? {}) as Record<string, unknown>).address === POSITIVE.asset
    );
    if (matching === undefined) {
      throw new Error("fixture has no matching transfer effect");
    }
    delete matching.fields;
    evm.observedEffects = effects;
    await expectGeneratedReportValid({
      content,
      expectedStatus: "UNKNOWN",
      expectedReasonCode: "NEC_PAYMENT_EFFECT_UNUSABLE"
    });
  });
});
