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

      const services = await getSelectedPlanPilotServices(
        project.settings.services.services,
      );
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
      const session = await createPlanPilotSession(services[0], {
        task: { domainPddl, problemPddl },
        configuration: {
          horizon: request.horizon,
          encoding: request.encoding,
          abstractTimeSteps: request.abstractTimeSteps,
        },
        source: {
          system: "IPEXCO",
          projectId: project._id,
          planId: plan._id,
        },
      });

      const run = await PlanPilotRunModel.create({
        project: project._id,
        user: req.user._id,
        plan: plan._id,
        service: services[0]._id,
        externalSessionId: session.sessionId,
        status: PlanPilotRunStatus.READY,
        configuration: session.configuration,
      });

      res.status(201).send({
        runId: run._id,
        externalSessionId: session.sessionId,
        status: run.status,
        configuration: session.configuration,
        facets: session.facets,
      });
    } catch (error) {
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
        context.run.externalSessionId,
      );
      res.status(200).send({ runId: context.run._id, facets: response.facets });
    } catch (error) {
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
        context.run.externalSessionId,
        requestData.data,
      );
      res.status(200).send({ runId: context.run._id, facets: response.facets });
    } catch (error) {
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
        context.run.externalSessionId,
        requestData.data,
      );
      res.status(200).send({ runId: context.run._id, result: response.result });
    } catch (error) {
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
        context.run.externalSessionId,
      );
      context.run.status = PlanPilotRunStatus.STOPPED;
      await context.run.save();
      res.status(200).send({
        runId: context.run._id,
        externalSessionId: response.sessionId,
        status: context.run.status,
      });
    } catch (error) {
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

async function getRunContext(req: AuthenticatedRequest, res: express.Response) {
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

  if (run.status === PlanPilotRunStatus.STOPPED) {
    res.status(409).send({ message: "PlanPilot run is already stopped." });
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
