import express from "express";
import { boolean, object, string } from "zod";

import { PDDLPlanningModel, toPDDL } from "../db_schema/PDDL_task";
import { PlanRunStatus } from "../db_schema/iteration_step";
import { PlanModel } from "../db_schema/plan";
import {
  PlanPilotRunModel,
  PlanPilotRunStatus,
} from "../db_schema/planpilot_run";
import { ProjectModel } from "../db_schema/project";
import {
  PlanPilotSessionConfigurationZ,
  QueryPlanPilotSessionRequestZ,
  SelectPlanPilotFacetRequestZ,
} from "../db_schema/service_communication";
import { Service, ServiceModel, ServiceType } from "../db_schema/services";
import { AuthenticatedRequest, authAny } from "../middleware/auth";
import {
  createPlanPilotSession,
  getPlanPilotSession,
  listPlanPilotFacets,
  PlanPilotClientError,
  queryPlanPilotSession,
  selectPlanPilotFacet,
  stopPlanPilotSession,
} from "../services/planpilot";

export const planPilotRouter = express.Router();

const StartPlanPilotSessionZ = object({
  planId: string(),
  horizon: PlanPilotSessionConfigurationZ.shape.horizon,
  encoding: PlanPilotSessionConfigurationZ.shape.encoding,
  abstractTimeSteps: boolean(),
});

planPilotRouter.post(
  "/sessions",
  authAny,
  async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        res.status(401).send();
        return;
      }

      const requestData = StartPlanPilotSessionZ.safeParse(req.body);
      if (!requestData.success) {
        res.status(400).send({ message: "Invalid PlanPilot session request." });
        return;
      }

      const request = requestData.data;
      const plan = await PlanModel.findOne({
        _id: request.planId,
        user: req.user._id,
      });

      if (!plan) {
        res.status(404).send({ message: "Plan not found." });
        return;
      }

      if (plan.status !== PlanRunStatus.SOLVED) {
        res.status(400).send({ message: "PlanPilot requires a solved plan." });
        return;
      }

      const project = await ProjectModel.findById(plan.project);
      if (!project) {
        res.status(404).send({ message: "Project not found." });
        return;
      }

      const selectedServices = await getSelectedPlanPilotServices(
        project.settings.services.services,
      );
      const services = selectedServices.filter((service) =>
        isServiceInProjectDomain(service, project.domain),
      );
      if (selectedServices.length > 0 && services.length === 0) {
        res.status(400).send({
          message: "No selected PlanPilot service matches project domain.",
        });
        return;
      }
      if (services.length === 0) {
        res.status(400).send({ message: "No PlanPilot service selected." });
        return;
      }

      if (services.length > 1) {
        res
          .status(400)
          .send({ message: "Select one PlanPilot service for the project." });
        return;
      }

      const [domainPddl, problemPddl] = toPDDL(
        project.baseTask.model as PDDLPlanningModel,
      );
      const configuration = {
        horizon: request.horizon,
        encoding: request.encoding,
        abstractTimeSteps: request.abstractTimeSteps,
      };
      const run = await PlanPilotRunModel.create({
        project: project._id,
        user: req.user._id,
        plan: plan._id,
        service: services[0]._id,
        status: PlanPilotRunStatus.STARTING,
        configuration,
      });

      try {
        const session = await createPlanPilotSession(services[0], {
          task: { domainPddl, problemPddl },
          configuration,
          source: {
            system: "IPEXCO",
            runId: run._id,
            projectId: project._id,
            planId: plan._id,
          },
        });

        run.externalSessionId = session.sessionId;
        run.status = PlanPilotRunStatus.READY;
        run.configuration = session.configuration;
        run.expiresAt = parseExpiresAt(session.expiresAt);
        await run.save();

        res.status(201).send({
          runId: run._id,
          externalSessionId: session.sessionId,
          status: run.status,
          configuration: session.configuration,
          expiresAt: run.expiresAt,
          facets: session.facets,
        });
      } catch (error) {
        run.status = PlanPilotRunStatus.FAILED;
        run.error = sanitizePlanPilotError(error);
        await run.save();
        throw error;
      }
    } catch (error) {
      sendPlanPilotRouteError(res, error);
    }
  },
);

planPilotRouter.get(
  "/sessions/:id",
  authAny,
  async (req: AuthenticatedRequest, res) => {
    try {
      const context = await getRunContext(req, res, { allowTerminal: true });
      if (!context) {
        return;
      }

      if (
        context.run.status === PlanPilotRunStatus.FAILED ||
        context.run.status === PlanPilotRunStatus.STOPPED ||
        context.run.status === PlanPilotRunStatus.EXPIRED
      ) {
        res.status(200).send(serializeRun(context.run));
        return;
      }

      const session = await getPlanPilotSession(
        context.service,
        context.run.externalSessionId!,
      );
      context.run.expiresAt = parseExpiresAt(session.expiresAt);
      await context.run.save();

      res.status(200).send({
        ...serializeRun(context.run),
        externalStatus: session.status,
        expiresAt: context.run.expiresAt,
      });
    } catch (error) {
      await markExpiredIfNeeded(req.params.id, req.user?._id, error);
      sendPlanPilotRouteError(res, error);
    }
  },
);

planPilotRouter.post(
  "/sessions/:id/facets/list",
  authAny,
  async (req: AuthenticatedRequest, res) => {
    try {
      const context = await getRunContext(req, res);
      if (!context) {
        return;
      }

      if (!isEmptyObject(req.body)) {
        res
          .status(400)
          .send({ message: "Facet list body must be an empty JSON object." });
        return;
      }

      const response = await listPlanPilotFacets(
        context.service,
        context.run.externalSessionId!,
      );
      res.status(200).send({ runId: context.run._id, facets: response.facets });
    } catch (error) {
      await markExpiredIfNeeded(req.params.id, req.user?._id, error);
      sendPlanPilotRouteError(res, error);
    }
  },
);

planPilotRouter.post(
  "/sessions/:id/facets/select",
  authAny,
  async (req: AuthenticatedRequest, res) => {
    try {
      const context = await getRunContext(req, res);
      if (!context) {
        return;
      }

      const requestData = SelectPlanPilotFacetRequestZ.safeParse(req.body);
      if (!requestData.success) {
        res
          .status(400)
          .send({ message: "Invalid PlanPilot facet selection request." });
        return;
      }

      const response = await selectPlanPilotFacet(
        context.service,
        context.run.externalSessionId!,
        requestData.data,
      );
      res.status(200).send({ runId: context.run._id, facets: response.facets });
    } catch (error) {
      await markExpiredIfNeeded(req.params.id, req.user?._id, error);
      sendPlanPilotRouteError(res, error);
    }
  },
);

planPilotRouter.post(
  "/sessions/:id/query",
  authAny,
  async (req: AuthenticatedRequest, res) => {
    try {
      const context = await getRunContext(req, res);
      if (!context) {
        return;
      }

      const requestData = QueryPlanPilotSessionRequestZ.safeParse(req.body);
      if (!requestData.success) {
        res.status(400).send({ message: "Invalid PlanPilot query request." });
        return;
      }

      const response = await queryPlanPilotSession(
        context.service,
        context.run.externalSessionId!,
        requestData.data,
      );
      res.status(200).send({ runId: context.run._id, result: response.result });
    } catch (error) {
      await markExpiredIfNeeded(req.params.id, req.user?._id, error);
      sendPlanPilotRouteError(res, error);
    }
  },
);

planPilotRouter.delete(
  "/sessions/:id",
  authAny,
  async (req: AuthenticatedRequest, res) => {
    try {
      const context = await getRunContext(req, res);
      if (!context) {
        return;
      }

      const response = await stopPlanPilotSession(
        context.service,
        context.run.externalSessionId!,
      );
      context.run.status = PlanPilotRunStatus.STOPPED;
      await context.run.save();
      res.status(200).send({
        runId: context.run._id,
        externalSessionId: response.sessionId,
        status: context.run.status,
      });
    } catch (error) {
      await markExpiredIfNeeded(req.params.id, req.user?._id, error);
      sendPlanPilotRouteError(res, error);
    }
  },
);

async function getSelectedPlanPilotServices(
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

async function getRunContext(
  req: AuthenticatedRequest,
  res: express.Response,
  options: { allowTerminal?: boolean } = {},
) {
  if (!req.user) {
    res.status(401).send();
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

  const service = await ServiceModel.findById(run.service);
  if (!service || service.type !== ServiceType.PLANPILOT) {
    res
      .status(400)
      .send({ message: "PlanPilot service for this run is not available." });
    return null;
  }

  return { run, service };
}

function isEmptyObject(value: unknown): boolean {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0,
  );
}

function isServiceInProjectDomain(
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

function parseExpiresAt(value: string | undefined): Date | undefined {
  if (!value) {
    return undefined;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function sanitizePlanPilotError(error: unknown): string {
  if (error instanceof PlanPilotClientError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "PlanPilot request failed.";
}

async function markExpiredIfNeeded(
  runId: string,
  userId: unknown,
  error: unknown,
): Promise<void> {
  if (
    !(error instanceof PlanPilotClientError) ||
    error.code !== "SESSION_EXPIRED" ||
    !userId
  ) {
    return;
  }
  await PlanPilotRunModel.updateOne(
    { _id: runId, user: userId },
    { status: PlanPilotRunStatus.EXPIRED },
  );
}

function serializeRun(run: {
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

function sendPlanPilotRouteError(res: express.Response, error: unknown): void {
  if (error instanceof PlanPilotClientError) {
    res.status(error.status ?? 502).send({
      message: error.message,
      code: error.code ?? "PLANPILOT_FAILED",
    });
    return;
  }

  console.log(error);
  res.status(500).send();
}
