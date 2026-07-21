import type { FacilitatorClient } from "@x402/core/server";
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  SupportedResponse,
  VerifyResponse
} from "@x402/core/types";

import type { TraceRecorder } from "./trace-recorder.js";

export const LAB_NETWORK = "eip155:84532" as const;
export const LAB_PAY_TO = "0x000000000000000000000000000000000000dEaD";

export interface FacilitatorCall {
  paymentPayload: PaymentPayload;
  requirements: PaymentRequirements;
}

/**
 * A deliberate trust-boundary double: it records and accepts x402 calls but
 * never submits a transaction or moves funds.
 */
export class RecordingFacilitatorClient implements FacilitatorClient {
  readonly verifyCalls: FacilitatorCall[] = [];
  readonly settleCalls: FacilitatorCall[] = [];

  constructor(private readonly trace: TraceRecorder) {}

  async getSupported(): Promise<SupportedResponse> {
    this.trace.record("facilitator.supported", {
      mode: "local-recording-double",
      network: LAB_NETWORK
    });
    return {
      kinds: [{ x402Version: 2, scheme: "exact", network: LAB_NETWORK }],
      extensions: [],
      signers: {
        "eip155:*": [LAB_PAY_TO]
      }
    };
  }

  async verify(
    paymentPayload: PaymentPayload,
    requirements: PaymentRequirements
  ): Promise<VerifyResponse> {
    this.verifyCalls.push({ paymentPayload, requirements });
    const payer = extractPayer(paymentPayload) ?? "lab:unresolved-payer";
    this.trace.record("facilitator.verify", {
      call: this.verifyCalls.length,
      accepted: true,
      payer,
      network: requirements.network,
      realNetworkVerification: false
    });
    return { isValid: true, payer };
  }

  async settle(
    paymentPayload: PaymentPayload,
    requirements: PaymentRequirements
  ): Promise<SettleResponse> {
    this.settleCalls.push({ paymentPayload, requirements });
    const payer = extractPayer(paymentPayload) ?? "lab:unresolved-payer";
    const transaction = `lab:settlement:${this.settleCalls.length}`;
    this.trace.record("facilitator.settle", {
      call: this.settleCalls.length,
      success: true,
      transaction,
      network: requirements.network,
      realFundsMoved: false
    });
    return {
      success: true,
      payer,
      transaction,
      network: requirements.network,
      amount: requirements.amount,
      extra: {
        labMode: "local-recording-double",
        realFundsMoved: false
      }
    };
  }
}

function extractPayer(payload: PaymentPayload): string | undefined {
  const authorization = payload.payload.authorization;
  if (authorization !== null && typeof authorization === "object" && !Array.isArray(authorization)) {
    const from = (authorization as Record<string, unknown>).from;
    return typeof from === "string" ? from : undefined;
  }
  return undefined;
}
