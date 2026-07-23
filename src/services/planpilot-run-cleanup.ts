import { PlanPilotRunModel, PlanPilotRunStatus } from "../db_schema/planpilot_run";
import { ServiceModel, ServiceType } from "../db_schema/services";
import {
  isMissingPlanPilotSession,
  PlanPilotClientError,
  stopPlanPilotSession,
} from "./planpilot";

export class PlanPilotRunCleanupError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "PlanPilotRunCleanupError";
  }
}

export async function removePlanPilotRuns(options: {
  userId: unknown;
  projectId?: unknown;
  iterationStepId?: unknown;
}): Promise<void> {
  if (!options.projectId && !options.iterationStepId) {
    throw new TypeError("PlanPilot run cleanup requires a project or iteration step.");
  }
  const filter = {
    user: options.userId,
    ...(options.projectId ? { project: options.projectId } : {}),
    ...(options.iterationStepId ? { iterationStep: options.iterationStepId } : {}),
  };

  const startingRun = await PlanPilotRunModel.exists({
    ...filter,
    status: PlanPilotRunStatus.STARTING,
  });
  if (startingRun) {
    throw new PlanPilotRunCleanupError(
      "A PlanPilot session is still being prepared. Retry deletion after it finishes.",
      409,
    );
  }

  const activeExternalRuns = await PlanPilotRunModel.find({
    ...filter,
    status: {
      $nin: [PlanPilotRunStatus.STOPPED, PlanPilotRunStatus.EXPIRED],
    },
    externalSessionId: { $exists: true, $ne: null },
  });
  for (const run of activeExternalRuns) {
    if (run.expiresAt && run.expiresAt.getTime() <= Date.now()) {
      continue;
    }
    const service = await ServiceModel.findById(run.service);
    if (!service || service.type !== ServiceType.PLANPILOT) {
      throw new PlanPilotRunCleanupError(
        "The active PlanPilot session cannot be stopped because its service is unavailable.",
        409,
      );
    }

    try {
      await stopPlanPilotSession(service, run.externalSessionId!);
    } catch (error) {
      if (!isMissingPlanPilotSession(error)) {
        throw new PlanPilotRunCleanupError(
          "The active PlanPilot session could not be stopped. Retry deletion when the service is available.",
          cleanupFailureStatus(error),
        );
      }
    }
  }

  await PlanPilotRunModel.deleteMany(filter);
}

function cleanupFailureStatus(error: unknown): number {
  if (
    error instanceof PlanPilotClientError
    && error.status
    && [502, 503, 504].includes(error.status)
  ) {
    return error.status;
  }
  return 502;
}
