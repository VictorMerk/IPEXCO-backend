import assert from "node:assert/strict";
import test from "node:test";

import { Service, ServiceType } from "../../db_schema/services";
import { PlanPilotRunModel } from "../../db_schema/planpilot_run";
import { ProjectModel } from "../../db_schema/project";
import {
  getRunContext,
  isEmptyObject,
  isServiceInProjectDomain,
  parseExpiresAt,
  planPilotSourceConflict,
  resolvePlanPilotSource,
} from "../../routes/planpilot-support";
import {
  isMongoDuplicateKey,
  planPilotSourceFingerprint,
  planPilotStartKey,
  stalePlanPilotStartBefore,
} from "../../services/planpilot-run-lifecycle";
import { defaultServiceIds } from "../../services/project-services";

function service(id: string, type: ServiceType, domainId: string | null = null) {
  return {
    _id: id,
    name: type,
    type,
    domainId,
    url: "http://service",
    apiKey: "key",
    encoding: "PDDL_CLASSIC",
  } as Service;
}

test("a run key separates users, projects, services and configurations", () => {
  const base = {
    userId: "user-a",
    projectId: "project-a",
    serviceId: "service-a",
    sourceFingerprint: "source-a",
    configuration: {
      horizon: 10,
      encoding: "bounded",
      abstractTimeSteps: false,
      stateFacets: false,
    },
  };
  const key = planPilotStartKey(base);

  assert.equal(key, planPilotStartKey({ ...base }));
  assert.notEqual(key, planPilotStartKey({ ...base, userId: "user-b" }));
  assert.notEqual(
    key,
    planPilotStartKey({
      ...base,
      configuration: { ...base.configuration, horizon: 11 },
    }),
  );
});

test("source fingerprints change with either PDDL document", () => {
  const first = planPilotSourceFingerprint({
    domainPddl: "(domain one)",
    problemPddl: "(problem one)",
  });
  assert.equal(
    first,
    planPilotSourceFingerprint({
      domainPddl: "(domain one)",
      problemPddl: "(problem one)",
    }),
  );
  assert.notEqual(
    first,
    planPilotSourceFingerprint({
      domainPddl: "(domain one)",
      problemPddl: "(problem two)",
    }),
  );
});

test("source conflict messages distinguish removed, invalid and changed tasks", () => {
  assert.equal(planPilotSourceConflict({ status: "available", fingerprint: "a" }, "a"), null);
  assert.equal(planPilotSourceConflict({ status: "missing" }, "a")?.code, "PLANPILOT_SOURCE_REMOVED");
  assert.equal(planPilotSourceConflict({ status: "invalid" }, "a")?.code, "PLANPILOT_SOURCE_INVALID");
  assert.equal(
    planPilotSourceConflict({ status: "available", fingerprint: "b" }, "a")?.code,
    "PLANPILOT_SOURCE_CHANGED",
  );
});

test("project service defaults contain at most one PlanPilot service", () => {
  const services = [
    service("planner", ServiceType.PLANNER),
    service("planpilot-a", ServiceType.PLANPILOT),
    service("planpilot-b", ServiceType.PLANPILOT),
    service("explainer", ServiceType.EXPLAINER),
  ];
  assert.deepEqual(defaultServiceIds(services), [
    "planner",
    "planpilot-a",
    "explainer",
  ]);
});

test("domain-specific services cannot leak into another project", () => {
  assert.equal(isServiceInProjectDomain(service("global", ServiceType.PLANPILOT), "domain-a"), true);
  assert.equal(
    isServiceInProjectDomain(
      service("matching", ServiceType.PLANPILOT, "domain-a"),
      "domain-a",
    ),
    true,
  );
  assert.equal(
    isServiceInProjectDomain(
      service("foreign", ServiceType.PLANPILOT, "domain-b"),
      "domain-a",
    ),
    false,
  );
});

test("project lookup always includes the authenticated owner", async () => {
  const originalFindOne = ProjectModel.findOne;
  let filter: unknown;
  (ProjectModel as unknown as { findOne: (query: unknown) => Promise<null> }).findOne =
    async (query) => {
      filter = query;
      return null;
    };
  const response = responseRecorder();
  try {
    const result = await resolvePlanPilotSource(
      "507f1f77bcf86cd799439011",
      "owner-a",
      response.value,
    );
    assert.equal(result, null);
    assert.deepEqual(filter, {
      _id: "507f1f77bcf86cd799439011",
      user: "owner-a",
    });
    assert.equal(response.status, 404);
  } finally {
    ProjectModel.findOne = originalFindOne;
  }
});

test("run lookup always includes the authenticated owner", async () => {
  const originalFindOne = PlanPilotRunModel.findOne;
  let filter: unknown;
  (PlanPilotRunModel as unknown as { findOne: (query: unknown) => Promise<null> }).findOne =
    async (query) => {
      filter = query;
      return null;
    };
  const response = responseRecorder();
  try {
    const result = await getRunContext(
      {
        params: { id: "507f1f77bcf86cd799439011" },
        user: { _id: "owner-a" },
      } as never,
      response.value,
    );
    assert.equal(result, null);
    assert.deepEqual(filter, {
      _id: "507f1f77bcf86cd799439011",
      user: "owner-a",
    });
    assert.equal(response.status, 404);
  } finally {
    PlanPilotRunModel.findOne = originalFindOne;
  }
});

test("expiry and duplicate-key helpers reject malformed values", () => {
  assert.equal(parseExpiresAt(undefined), undefined);
  assert.equal(parseExpiresAt("not-a-date"), undefined);
  assert.equal(parseExpiresAt("2026-08-09T12:00:00.000Z")?.toISOString(), "2026-08-09T12:00:00.000Z");
  assert.equal(isMongoDuplicateKey({ code: 11000 }), true);
  assert.equal(isMongoDuplicateKey({ code: 1 }), false);
  assert.equal(isEmptyObject({}), true);
  assert.equal(isEmptyObject([]), false);
});

test("stale starts include the upstream timeout and a cleanup margin", () => {
  const previous = process.env.PLANPILOT_REQUEST_TIMEOUT_MS;
  process.env.PLANPILOT_REQUEST_TIMEOUT_MS = "1000";
  try {
    assert.equal(stalePlanPilotStartBefore(50_000).getTime(), 19_000);
  } finally {
    if (previous === undefined) {
      delete process.env.PLANPILOT_REQUEST_TIMEOUT_MS;
    } else {
      process.env.PLANPILOT_REQUEST_TIMEOUT_MS = previous;
    }
  }
});

function responseRecorder() {
  const recorder = {
    status: 0,
    body: undefined as unknown,
    value: {
      status(code: number) {
        recorder.status = code;
        return this;
      },
      send(body: unknown) {
        recorder.body = body;
        return this;
      },
    } as never,
  };
  return recorder;
}
