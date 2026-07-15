import { createHash } from "node:crypto";

export type PlanPilotStartIdentity = {
  userId: unknown;
  iterationStepId: unknown;
  serviceId: unknown;
  sourceFingerprint: string;
  configuration: {
    horizon: number;
    encoding: string;
    abstractTimeSteps: boolean;
  };
};

// Only active starts keep this key.
export function planPilotStartKey(identity: PlanPilotStartIdentity): string {
  const value = [
    String(identity.userId),
    String(identity.iterationStepId),
    String(identity.serviceId),
    identity.sourceFingerprint,
    identity.configuration.encoding,
    identity.configuration.horizon,
    identity.configuration.abstractTimeSteps ? "abstract" : "concrete",
  ].join("\u0000");
  return createHash("sha256").update(value).digest("hex");
}

export function planPilotSourceFingerprint(source: {
  domainPddl: string;
  problemPddl: string;
  representativePlan?: Array<{ name: string; params: string[] }>;
}): string {
  const value = JSON.stringify({
    domainPddl: source.domainPddl,
    problemPddl: source.problemPddl,
    representativePlan: source.representativePlan ?? null,
  });
  return createHash("sha256").update(value).digest("hex");
}

export function isMongoDuplicateKey(error: unknown): boolean {
  return Boolean(
    error
      && typeof error === "object"
      && "code" in error
      && (error as { code?: unknown }).code === 11000,
  );
}

export function stalePlanPilotStartBefore(now = Date.now()): Date {
  const configured = Number(process.env.PLANPILOT_REQUEST_TIMEOUT_MS);
  const requestTimeout = Number.isSafeInteger(configured) && configured > 0
    ? configured
    : 345_000;
  return new Date(now - requestTimeout - 30_000);
}
