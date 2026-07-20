import express from "express";
import { HydratedDocument } from "mongoose";

import { PDDLPlanningModel, toPDDL } from "../db_schema/PDDL_task";
import {
  PlanPilotRun,
  PlanPilotRunModel,
  PlanPilotRunStatus,
} from "../db_schema/planpilot_run";
import { ProjectModel } from "../db_schema/project";
import { Service, ServiceModel, ServiceType } from "../db_schema/services";
import { AuthenticatedRequest } from "../middleware/auth";
import {
  isMissingPlanPilotSession,
  PlanPilotClientError,
  stopPlanPilotSession,
} from "../services/planpilot";
import { planPilotSourceFingerprint } from "../services/planpilot-run-lifecycle";

export async function getSelectedPlanPilotServices(
  serviceIds: string[],
): Promise<Service[]> {
  const services: Service[] = [];

  for (const serviceId of serviceIds) {
    const service = await ServiceModel.findById(serviceId);
    if (service && service.type === ServiceType.PLANPILOT) {
      services.push(service);
    }
  }

  return services;
}

export async function resolvePlanPilotSource(
  projectId: string,
  userId: unknown,
  res: express.Response,
) {
  const project = await ProjectModel.findOne({
    _id: projectId,
    user: userId,
  });
  if (!project) {
    res.status(404).send({ message: "Project not found." });
    return null;
  }

  return {
    project,
    pddlModel: structuredClone(project.baseTask.model as PDDLPlanningModel),
  };
}

export type PlanPilotSourceFingerprintResult =
  | { status: "available"; fingerprint: string }
  | { status: "missing" }
  | { status: "invalid" };

export async function inspectPlanPilotSourceFingerprint(
  projectId: unknown,
  userId: unknown,
): Promise<PlanPilotSourceFingerprintResult> {
  const project = await ProjectModel.findOne({ _id: projectId, user: userId });
  if (!project) {
    return { status: "missing" };
  }

  try {
    const [domainPddl, problemPddl] = toPDDL(
      structuredClone(project.baseTask.model as PDDLPlanningModel),
    );
    return {
      status: "available",
      fingerprint: planPilotSourceFingerprint({ domainPddl, problemPddl }),
    };
  } catch {
    return { status: "invalid" };
  }
}

export function planPilotSourceConflict(
  current: PlanPilotSourceFingerprintResult,
  expectedFingerprint: string,
): { message: string; code: string } | null {
  if (current.status === "missing") {
    return {
      message: "The PlanPilot source was deleted while the session was being prepared.",
      code: "PLANPILOT_SOURCE_REMOVED",
    };
  }
  if (current.status === "invalid") {
    return {
      message: "The project task became invalid while the PlanPilot session was being prepared.",
      code: "PLANPILOT_SOURCE_INVALID",
    };
  }
  if (current.fingerprint !== expectedFingerprint) {
    return {
      message: "The project task changed while the PlanPilot session was being prepared.",
      code: "PLANPILOT_SOURCE_CHANGED",
    };
  }
  return null;
}

type PlanPilotRunContext = {
  run: HydratedDocument<PlanPilotRun>;
  service: Service;
};

type PlanPilotTerminalRunContext = {
  run: HydratedDocument<PlanPilotRun>;
  service: Service | null;
};

export function getRunContext(
  req: AuthenticatedRequest,
  res: express.Response,
  options: { allowTerminal: true; skipServiceLookupForTerminal: true },
): Promise<PlanPilotTerminalRunContext | null>;
export function getRunContext(
  req: AuthenticatedRequest,
  res: express.Response,
  options?: { allowTerminal?: boolean; skipServiceLookupForTerminal?: false },
): Promise<PlanPilotRunContext | null>;
export async function getRunContext(
  req: AuthenticatedRequest,
  res: express.Response,
  options: {
    allowTerminal?: boolean;
    skipServiceLookupForTerminal?: boolean;
  } = {},
): Promise<PlanPilotRunContext | PlanPilotTerminalRunContext | null> {
  if (!req.user) {
    res.status(401).send();
    return null;
  }

  if (!/^[a-f\d]{24}$/i.test(req.params.id)) {
    res.status(400).send({ message: "Invalid PlanPilot run ID." });
    return null;
  }

  const run = await PlanPilotRunModel.findOne({
    _id: req.params.id,
    user: req.user._id,
  });
  if (!run) {
    res.status(404).send({ message: "PlanPilot run not found." });
    return null;
  }

  if (
    run.status === PlanPilotRunStatus.READY &&
    isExpiredDate(run.expiresAt)
  ) {
    run.status = PlanPilotRunStatus.EXPIRED;
    await run.save();
  }

  if (!options.allowTerminal && run.status === PlanPilotRunStatus.STOPPED) {
    res.status(409).send({ message: "PlanPilot run is already stopped." });
    return null;
  }

  if (!options.allowTerminal && run.status === PlanPilotRunStatus.EXPIRED) {
    res.status(410).send({ message: "PlanPilot run has expired." });
    return null;
  }

  if (!options.allowTerminal && run.status === PlanPilotRunStatus.FAILED) {
    res.status(409).send({ message: "PlanPilot run has failed." });
    return null;
  }

  if (!options.allowTerminal && !run.externalSessionId) {
    res.status(409).send({ message: "PlanPilot run is not ready." });
    return null;
  }

  if (
    options.skipServiceLookupForTerminal
    && [
      PlanPilotRunStatus.FAILED,
      PlanPilotRunStatus.STOPPED,
      PlanPilotRunStatus.EXPIRED,
    ].includes(run.status)
  ) {
    return { run, service: null };
  }

  const service = await ServiceModel.findById(run.service);
  if (!service || service.type !== ServiceType.PLANPILOT) {
    res
      .status(400)
      .send({ message: "PlanPilot service for this run is not available." });
    return null;
  }

  return { run, service };
}

export async function retireSupersededPlanPilotRuns(
  userId: unknown,
  projectId: unknown,
  service: Service,
  sourceFingerprint: string,
): Promise<void> {
  const runs = await PlanPilotRunModel.find({
    user: userId,
    project: projectId,
    service: service._id,
    sourceFingerprint: { $ne: sourceFingerprint },
    status: PlanPilotRunStatus.READY,
    externalSessionId: { $exists: true, $ne: null },
  });

  for (const run of runs) {
    try {
      await stopPlanPilotSession(service, run.externalSessionId!);
      run.status = PlanPilotRunStatus.STOPPED;
      run.error = "Superseded by changed PlanPilot source data.";
      await run.save();
    } catch (error) {
      if (isMissingPlanPilotSession(error)) {
        run.status = PlanPilotRunStatus.EXPIRED;
        run.error = sanitizePlanPilotError(error);
        await run.save();
        continue;
      }
      console.warn(
        `Could not stop superseded PlanPilot run ${String(run._id)}: ${sanitizePlanPilotError(error)}`,
      );
    }
  }
}

export function isEmptyObject(value: unknown): boolean {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0,
  );
}

export function isServiceInProjectDomain(
  service: Service,
  projectDomainId: unknown,
): boolean {
  if (!service.domainId) {
    return true;
  }
  if (!projectDomainId) {
    return false;
  }
  return String(service.domainId) === String(projectDomainId);
}

export function parseExpiresAt(value: string | undefined): Date | undefined {
  if (!value) {
    return undefined;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export async function updatePlanPilotRunExpiry(
  run: HydratedDocument<PlanPilotRun>,
  expiresAt: string,
): Promise<void> {
  run.expiresAt = parseExpiresAt(expiresAt);
  await run.save();
}

export function sanitizePlanPilotError(error: unknown): string {
  if (error instanceof PlanPilotClientError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "PlanPilot request failed.";
}

export async function markExpiredIfNeeded(
  runId: string,
  userId: unknown,
  error: unknown,
): Promise<void> {
  if (!(error instanceof PlanPilotClientError) || !userId) {
    return;
  }
  if (
    error.code !== "SESSION_EXPIRED" &&
    error.code !== "SESSION_NOT_FOUND" &&
    error.status !== 404 &&
    error.status !== 410
  ) {
    return;
  }
  await PlanPilotRunModel.updateOne(
    { _id: runId, user: userId },
    { status: PlanPilotRunStatus.EXPIRED },
  );
}

export function serializeRun(run: {
  _id: unknown;
  externalSessionId?: string | null;
  status: PlanPilotRunStatus;
  configuration: unknown;
  error?: string | null;
  expiresAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}) {
  return {
    runId: run._id,
    externalSessionId: run.externalSessionId,
    status: run.status,
    configuration: run.configuration,
    error: run.error,
    expiresAt: run.expiresAt,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

export function sendPlanPilotRouteError(
  res: express.Response,
  error: unknown,
): void {
  if (error instanceof PlanPilotClientError) {
    if (error.retryAfter && /^\d+$/.test(error.retryAfter)) {
      res.set("Retry-After", error.retryAfter);
    }
    res.status(error.status ?? 502).send({
      message: error.message,
      code: error.code ?? "PLANPILOT_FAILED",
    });
    return;
  }

  console.error("PlanPilot route failed:", error);
  res.status(500).send();
}

function isExpiredDate(value: unknown): boolean {
  return value instanceof Date && value.getTime() <= Date.now();
}
