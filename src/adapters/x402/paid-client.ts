import { decodePaymentResponseHeader } from "@x402/core/http";
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import type { TraceRecorder } from "./trace-recorder.js";

export interface CapturedHttpResponse {
  resourceUrl: string;
  status: number;
  headers: Record<string, string>;
  body: unknown;
  paymentResponse?: unknown;
}

export async function executePaidRequest(
  url: string,
  trace: TraceRecorder
): Promise<CapturedHttpResponse> {
  const account = privateKeyToAccount(generatePrivateKey());
  const client = new x402Client();
  registerExactEvmScheme(client, { signer: account });
  const paidFetch = wrapFetchWithPayment(globalThis.fetch, client);

  trace.record("client.request-started", { url, payer: account.address });
  const response = await paidFetch(url, { headers: { accept: "application/json" } });
  const text = await response.text();
  const body = parseBody(text);
  const paymentHeader = response.headers.get("payment-response");
  const paymentResponse = paymentHeader === null
    ? undefined
    : decodePaymentResponseHeader(paymentHeader);

  trace.record("client.response-received", {
    status: response.status,
    paymentResponsePresent: paymentHeader !== null
  });

  return {
    resourceUrl: url,
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body,
    ...(paymentResponse === undefined ? {} : { paymentResponse })
  };
}

function parseBody(text: string): unknown {
  if (text.length === 0) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}
