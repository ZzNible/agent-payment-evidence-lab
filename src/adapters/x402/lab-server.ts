import { createServer, type Server } from "node:http";

import type { RoutesConfig } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import {
  paymentMiddlewareFromHTTPServer,
  x402HTTPResourceServer,
  x402ResourceServer
} from "@x402/express";
import express from "express";

import { JobStore } from "./job-store.js";
import {
  LAB_NETWORK,
  LAB_PAY_TO,
  RecordingFacilitatorClient
} from "./recording-facilitator.js";
import { TraceRecorder } from "./trace-recorder.js";

export interface LabServer {
  baseUrl: string;
  facilitator: RecordingFacilitatorClient;
  trace: TraceRecorder;
  jobs: JobStore;
  close(): Promise<void>;
}

const routes: RoutesConfig = {
  "GET /scenario/:name": {
    accepts: {
      scheme: "exact",
      network: LAB_NETWORK,
      payTo: LAB_PAY_TO,
      price: "$0.001"
    },
    description: "Local x402 evidence experiment",
    mimeType: "application/json"
  }
};

export async function startLabServer(): Promise<LabServer> {
  const trace = new TraceRecorder();
  const facilitator = new RecordingFacilitatorClient(trace);
  const jobs = new JobStore();

  const resourceServer = new x402ResourceServer(facilitator)
    .register(LAB_NETWORK, new ExactEvmScheme())
    .onAfterVerify(async context => {
      trace.record("x402.after-verify", {
        isValid: context.result.isValid,
        payer: context.result.payer ?? "unknown"
      });
    })
    .onBeforeSettle(async context => {
      trace.record("x402.before-settle", {
        network: context.requirements.network,
        amount: context.requirements.amount
      });
    })
    .onAfterSettle(async context => {
      trace.record("x402.after-settle", {
        success: context.result.success,
        transaction: context.result.transaction
      });
    })
    .onVerifiedPaymentCanceled(async context => {
      trace.record("x402.payment-canceled", {
        reason: context.reason,
        ...(context.responseStatus === undefined ? {} : { responseStatus: context.responseStatus })
      });
    });

  const httpResourceServer = new x402HTTPResourceServer(resourceServer, routes);
  await httpResourceServer.initialize();

  const app = express();
  app.use((request, _response, next) => {
    trace.record("http.request", {
      method: request.method,
      path: request.path,
      hasPaymentSignature: request.header("PAYMENT-SIGNATURE") !== undefined
    });
    next();
  });
  app.use(paymentMiddlewareFromHTTPServer(httpResourceServer, undefined, undefined, false));

  app.get("/scenario/:name", (request, response) => {
    const interactionId = stringQuery(request.query.interactionId) ?? "missing-interaction-id";
    response.setHeader("x-interaction-id", interactionId);
    trace.record("handler.started", { scenario: request.params.name, interactionId });

    switch (request.params.name) {
      case "valid-synchronous":
      case "self-attested-completion":
      case "independent-source-statement":
        response.status(200).json({ status: "ok", data: { result: "deliverable-ready" } });
        break;
      case "handler-500":
        response.status(500).json({ status: "error", error: "synthetic-handler-failure" });
        break;
      case "settled-invalid-schema":
        response.status(200).json({ status: "ok", data: { message: "wrong-field" } });
        break;
      case "accepted-then-async-failure": {
        const jobId = `job-${interactionId}`;
        jobs.create(jobId);
        response.status(202).json({ status: "accepted", jobId });
        break;
      }
      default:
        response.status(404).json({ status: "error", error: "unknown-scenario" });
    }

    trace.record("handler.completed", {
      scenario: request.params.name,
      status: response.statusCode
    });
  });

  const server = createServer(app);
  await listen(server);
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Lab server did not bind to a TCP port.");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    facilitator,
    trace,
    jobs,
    close: () => close(server)
  };
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close(error => {
      if (error === undefined) {
        resolve();
      } else {
        reject(error);
      }
    });
  });
}

function stringQuery(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
