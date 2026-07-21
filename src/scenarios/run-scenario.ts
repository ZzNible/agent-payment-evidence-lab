import { randomUUID } from "node:crypto";

import { executePaidRequest } from "../adapters/x402/paid-client.js";
import { startLabServer } from "../adapters/x402/lab-server.js";
import { createArtifact } from "../domain/artifacts.js";
import type {
  Controller,
  EvidenceArtifact,
  EvidenceBundle,
  IssuerRole,
  ScenarioOutput,
  TrustContext,
  VerificationPlan
} from "../domain/types.js";
import { BUNDLE_SPEC_VERSION, PLAN_SPEC_VERSION } from "../domain/types.js";
import { analyzeEvidence } from "../engine/analyze.js";
import { sha256 } from "../security/digest.js";
import { readProjectFile } from "../security/project-files.js";
import {
  createEd25519Identity,
  exportPublicKey,
  signJson,
  type Ed25519Identity
} from "../security/signatures.js";
import {
  scenarioDefinitions,
  type ScenarioDefinition,
  type ScenarioName
} from "./definitions.js";

export async function runScenario(name: ScenarioName): Promise<ScenarioOutput> {
  const definition = scenarioDefinitions[name];
  const server = await startLabServer();
  const interactionId = `${name}-${randomUUID()}`;
  const resource = `${server.baseUrl}/scenario/${name}?interactionId=${encodeURIComponent(interactionId)}`;
  const createdAt = new Date().toISOString();
  const schema = await loadOutputSchema();
  const trustMaterial = createTrustMaterial(name);

  const plan: VerificationPlan = {
    specVersion: PLAN_SPEC_VERSION,
    planId: `plan-${interactionId}`,
    createdAt,
    subject: { interactionId, resource },
    claims: definition.claims.map(item => ({
      ...item,
      ...(item.type === "OUTPUT_SCHEMA_VALID"
        ? {
            parameters: {
              ...item.parameters,
              schemaDigest: sha256(schema)
            }
          }
        : {})
    })),
    trustProfile: trustProfileFor(name),
    trustProfileDigest: sha256(trustMaterial.context)
  };

  try {
    const response = await executePaidRequest(resource, server.trace);
    const artifacts = buildProtocolArtifacts(
      definition,
      interactionId,
      createdAt,
      response,
      server.facilitator.verifyCalls[0],
      server.facilitator.settleCalls[0],
      server.trace.find("x402.payment-canceled")?.details,
      schema,
      trustMaterial
    );

    if (name === "accepted-then-async-failure") {
      const responseBody = asRecord(response.body);
      const jobId = responseBody?.jobId;
      if (typeof jobId !== "string") {
        throw new Error("Async scenario did not return a job ID.");
      }
      const terminal = server.jobs.setStatus(jobId, "failed");
      server.trace.record("job.terminal-state-observed", {
        jobId,
        status: terminal.status,
        source: "provider-job-api"
      });
      artifacts.push(
        createArtifact({
          id: "job-terminal-status",
          kind: "job.status",
          capturedAt: terminal.updatedAt,
          issuerId: "lab-job-state-adapter",
          issuerRole: "LAB_FIXTURE",
          controller: "LAB_FIXTURE",
          interactionId,
          content: terminal,
          signer: envelope => signJson(envelope, trustMaterial.jobStateIdentity)
        })
      );
    }

    if (name === "self-attested-completion" || name === "independent-source-statement") {
      if (trustMaterial.statementIdentity === undefined) {
        throw new Error("Statement scenario did not precommit a signing identity.");
      }
      artifacts.push(
        createCompletionStatement(name, interactionId, trustMaterial.statementIdentity)
      );
    }

    const bundle: EvidenceBundle = {
      specVersion: BUNDLE_SPEC_VERSION,
      bundleId: `bundle-${interactionId}`,
      createdAt: new Date().toISOString(),
      subject: {
        interactionId,
        protocol: "x402",
        protocolVersion: "2.19.0"
      },
      artifacts,
      trustContext: trustMaterial.context
    };

    const report = await analyzeEvidence(plan, bundle);
    return { scenario: name, plan, bundle, report, trace: server.trace.events };
  } finally {
    await server.close();
  }
}

interface CapturedResponse {
  resourceUrl: string;
  status: number;
  headers: Record<string, string>;
  body: unknown;
  paymentResponse?: unknown;
}

interface RecordedCall {
  paymentPayload: unknown;
  requirements: unknown;
}

function buildProtocolArtifacts(
  definition: ScenarioDefinition,
  interactionId: string,
  capturedAt: string,
  response: CapturedResponse,
  verification: RecordedCall | undefined,
  settlement: RecordedCall | undefined,
  cancellation: Record<string, unknown> | undefined,
  outputSchema: unknown,
  trustMaterial: ScenarioTrustMaterial
): EvidenceArtifact[] {
  const artifacts: EvidenceArtifact[] = [
    createArtifact({
      id: "output-schema",
      kind: "contract.output-schema",
      capturedAt,
      issuerId: "precommitted-verification-plan",
      issuerRole: "LAB_FIXTURE",
      controller: "LAB_FIXTURE",
      interactionId,
      content: outputSchema
    }),
    createArtifact({
      id: "http-response",
      kind: "http.response",
      capturedAt: new Date().toISOString(),
      issuerId: "lab-http-capture-adapter",
      issuerRole: "LAB_FIXTURE",
      controller: "LAB_FIXTURE",
      interactionId,
      content: response,
      signer: envelope => signJson(envelope, trustMaterial.httpCaptureIdentity)
    })
  ];

  if (verification !== undefined) {
    artifacts.push(
      createArtifact({
        id: "payment-verification",
        kind: "x402.payment-verification",
        capturedAt: new Date().toISOString(),
        issuerId: "local-recording-facilitator",
        issuerRole: "PAYMENT_FACILITATOR",
        controller: "LAB_FIXTURE",
        interactionId,
        content: {
          isValid: true,
          mode: "local-recording-double",
          realNetworkVerification: false,
          paymentPayload: verification.paymentPayload,
          requirements: verification.requirements
        },
        signer: envelope => signJson(envelope, trustMaterial.facilitatorIdentity)
      })
    );
  }

  if (settlement !== undefined) {
    artifacts.push(
      createArtifact({
        id: "settlement-boundary",
        kind: "x402.settlement-boundary",
        capturedAt: new Date().toISOString(),
        issuerId: "local-recording-facilitator",
        issuerRole: "PAYMENT_FACILITATOR",
        controller: "LAB_FIXTURE",
        interactionId,
        content: {
          success: true,
          mode: "local-recording-double",
          realFundsMoved: false,
          transaction: asRecord(response.paymentResponse)?.transaction ?? "lab:settlement:unknown",
          paymentResponse: response.paymentResponse ?? null,
          requirements: settlement.requirements,
          note: "No response-body digest is committed by this synthetic x402 receipt."
        },
        signer: envelope => signJson(envelope, trustMaterial.facilitatorIdentity)
      })
    );
  } else if (cancellation !== undefined) {
    artifacts.push(
      createArtifact({
        id: "payment-cancellation",
        kind: "x402.payment-cancellation",
        capturedAt: new Date().toISOString(),
        issuerId: "x402-express-middleware",
        issuerRole: "LAB_FIXTURE",
        controller: "LAB_FIXTURE",
          interactionId,
          content: cancellation,
          signer: envelope => signJson(envelope, trustMaterial.middlewareIdentity)
      })
    );
  }

  if (response.status !== definition.expectedHttpStatus) {
    throw new Error(
      `Scenario ${definition.name} expected HTTP ${definition.expectedHttpStatus}, received ${response.status}.`
    );
  }
  return artifacts;
}

function createCompletionStatement(
  name: "self-attested-completion" | "independent-source-statement",
  interactionId: string,
  identity: Ed25519Identity
): EvidenceArtifact {
  const content = {
    interaction_id: interactionId,
    job_status: "completed",
    observed_at: new Date().toISOString()
  };
  const separateSource = name === "independent-source-statement";
  const issuerId = separateSource ? "lab-separate-observer" : "local-provider";
  const role: IssuerRole = separateSource ? "EXTERNAL_SOURCE" : "PROVIDER";
  const controller: Controller = separateSource ? "THIRD_PARTY" : "PROVIDER";
  return createArtifact({
    id: "completion-statement",
    kind: "source.statement",
    capturedAt: content.observed_at,
    issuerId,
    issuerRole: role,
    controller,
    interactionId,
    content,
    signer: envelope => signJson(envelope, identity)
  });
}

interface ScenarioTrustMaterial {
  context: TrustContext;
  facilitatorIdentity: Ed25519Identity;
  httpCaptureIdentity: Ed25519Identity;
  jobStateIdentity: Ed25519Identity;
  middlewareIdentity: Ed25519Identity;
  statementIdentity?: Ed25519Identity;
}

function createTrustMaterial(name: ScenarioName): ScenarioTrustMaterial {
  const facilitatorIdentity = createEd25519Identity();
  const httpCaptureIdentity = createEd25519Identity();
  const jobStateIdentity = createEd25519Identity();
  const middlewareIdentity = createEd25519Identity();
  const authoritativeSources = name === "accepted-then-async-failure"
    ? ["lab-job-state-adapter"]
    : [];
  const baseAssumptions = [
    "The recording facilitator models the x402 settlement boundary; it is not production or on-chain evidence.",
    "The test payer uses an ephemeral local key and no real funds."
  ];
  if (name !== "self-attested-completion" && name !== "independent-source-statement") {
    return {
      facilitatorIdentity,
      httpCaptureIdentity,
      jobStateIdentity,
      middlewareIdentity,
      context: {
        authoritativeSources,
        independentSources: [],
        sourcePublicKeys: {
          "local-recording-facilitator": exportPublicKey(facilitatorIdentity),
          "lab-http-capture-adapter": exportPublicKey(httpCaptureIdentity),
          "lab-job-state-adapter": exportPublicKey(jobStateIdentity),
          "x402-express-middleware": exportPublicKey(middlewareIdentity)
        },
        declaredAssumptions: baseAssumptions
      }
    };
  }

  const separateSource = name === "independent-source-statement";
  const statementIdentity = createEd25519Identity();
  const issuerId = separateSource ? "lab-separate-observer" : "local-provider";
  return {
    facilitatorIdentity,
    httpCaptureIdentity,
    jobStateIdentity,
    middlewareIdentity,
    statementIdentity,
    context: {
      authoritativeSources,
      independentSources: [],
      sourcePublicKeys: {
        "local-recording-facilitator": exportPublicKey(facilitatorIdentity),
        "lab-http-capture-adapter": exportPublicKey(httpCaptureIdentity),
        "lab-job-state-adapter": exportPublicKey(jobStateIdentity),
        "x402-express-middleware": exportPublicKey(middlewareIdentity),
        [issuerId]: exportPublicKey(statementIdentity)
      },
      declaredAssumptions: [
        ...baseAssumptions,
        ...(separateSource
          ? ["lab-separate-observer has a distinct fixture identity; institutional independence is not established."]
          : ["local-provider controls the source that makes the completion statement."])
      ]
    }
  };
}

async function loadOutputSchema(): Promise<unknown> {
  return JSON.parse(await readProjectFile("schemas/report-output.schema.json")) as unknown;
}

function trustProfileFor(name: ScenarioName): string {
  return name === "independent-source-statement"
    ? "local-x402-with-separate-source-v0"
    : "local-x402-fixture-v0";
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
