import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { Service } from "../../db_schema/services";
import {
  PlanPilotClientError,
  isMissingPlanPilotSession,
  stopPlanPilotSession,
} from "../../services/planpilot";

const originalFetch = globalThis.fetch;
const originalTimeout = process.env.PLANPILOT_REQUEST_TIMEOUT_MS;

const service = {
  _id: "507f1f77bcf86cd799439011",
  name: "PlanPilot",
  type: "PLANPILOT",
  domainId: null,
  url: "http://planpilot:5000/",
  apiKey: "test-key",
  encoding: "PDDL_CLASSIC",
} as Service;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalTimeout === undefined) {
    delete process.env.PLANPILOT_REQUEST_TIMEOUT_MS;
  } else {
    process.env.PLANPILOT_REQUEST_TIMEOUT_MS = originalTimeout;
  }
});

test("sends the service key and encodes the session id", async () => {
  let request: { url?: string; init?: RequestInit } = {};
  globalThis.fetch = async (input, init) => {
    request = { url: String(input), init };
    return new Response(
      JSON.stringify({ sessionId: "session/one", status: "stopped" }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  const result = await stopPlanPilotSession(service, "session/one");

  assert.deepEqual(result, { sessionId: "session/one", status: "stopped" });
  assert.equal(
    request.url,
    "http://planpilot:5000/api/sessions/session%2Fone",
  );
  assert.equal(request.init?.method, "DELETE");
  assert.equal(
    (request.init?.headers as Record<string, string>).authorization,
    "Bearer test-key",
  );
});

test("preserves upstream status, code and retry information", async () => {
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        error: {
          code: "PLANPILOT_SESSION_LIMIT",
          message: "No session slot is available.",
        },
      }),
      { status: 503, headers: { "retry-after": "5" } },
    );

  await assert.rejects(
    stopPlanPilotSession(service, "pp_sess_1"),
    (error: unknown) => {
      assert.ok(error instanceof PlanPilotClientError);
      assert.equal(error.status, 503);
      assert.equal(error.code, "PLANPILOT_SESSION_LIMIT");
      assert.equal(error.retryAfter, "5");
      return true;
    },
  );
});

test("rejects a successful response that violates the service contract", async () => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ status: "stopped" }), { status: 200 });

  await assert.rejects(
    stopPlanPilotSession(service, "pp_sess_1"),
    (error: unknown) => {
      assert.ok(error instanceof PlanPilotClientError);
      assert.equal(error.status, 502);
      assert.equal(error.code, "PLANPILOT_INVALID_RESPONSE");
      return true;
    },
  );
});

test("turns an aborted upstream request into a timeout error", async () => {
  process.env.PLANPILOT_REQUEST_TIMEOUT_MS = "10";
  globalThis.fetch = async (_input, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new DOMException("aborted", "AbortError"));
      });
    });

  await assert.rejects(
    stopPlanPilotSession(service, "pp_sess_1"),
    (error: unknown) => {
      assert.ok(error instanceof PlanPilotClientError);
      assert.equal(error.status, 504);
      assert.equal(error.code, "PLANPILOT_TIMEOUT");
      return true;
    },
  );
});

test("recognizes missing and expired upstream sessions", () => {
  assert.equal(
    isMissingPlanPilotSession(
      new PlanPilotClientError("gone", 410, "SESSION_EXPIRED"),
    ),
    true,
  );
  assert.equal(
    isMissingPlanPilotSession(new PlanPilotClientError("failed", 500, "FAILED")),
    false,
  );
});
