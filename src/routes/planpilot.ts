import express from "express";
import { boolean, object, string } from "zod";

import { toPDDL } from "../db_schema/PDDL_task";
import {
  PlanPilotRunModel,
  PlanPilotRunStatus,
} from "../db_schema/planpilot_run";
import { ProjectModel } from "../db_schema/project";
import {
  ApplyPlanPilotFacetsRequestZ,
  PlanPilotSessionConfigurationZ,
  QueryPlanPilotSessionRequestZ,
  SelectPlanPilotFacetRequestZ,
} from "../db_schema/planpilot_service_communication";
import { AuthenticatedRequest, authAny } from "../middleware/auth";
import {
  applyPlanPilotFacets,
  createPlanPilotSession,
  getPlanPilotSession,
  isMissingPlanPilotSession,
  listPlanPilotFacets,
  queryPlanPilotSession,
  selectPlanPilotFacet,
  stopPlanPilotSession,
} from "../services/planpilot";
import {
  isMongoDuplicateKey,
  planPilotStartKey,
  planPilotSourceFingerprint,
  stalePlanPilotStartBefore,
} from "../services/planpilot-run-lifecycle";
import {
  getRunContext,
  getSelectedPlanPilotServices,
  inspectPlanPilotSourceFingerprint,
  isEmptyObject,
  isServiceInProjectDomain,
  markExpiredIfNeeded,
  parseExpiresAt,
  planPilotSourceConflict,
  resolvePlanPilotSource,
  retireSupersededPlanPilotRuns,
  sanitizePlanPilotError,
  sendPlanPilotRouteError,
  serializeRun,
  updatePlanPilotRunExpiry,
} from "./planpilot-support";

export const planPilotRouter = express.Router();

const StartPlanPilotSessionZ = object({
  projectId: string().regex(/^[a-f\d]{24}$/i),
  horizon: PlanPilotSessionConfigurationZ.shape.horizon,
  encoding: PlanPilotSessionConfigurationZ.shape.encoding,
  abstractTimeSteps: boolean(),
  stateFacets: boolean().optional().default(false),
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
      const source = await resolvePlanPilotSource(
        request.projectId,
        req.user._id,
        res,
      );
      if (!source) {
        return;
      }

      const selectedServices = await getSelectedPlanPilotServices(
        source.project.settings.services.services,
      );
      const services = selectedServices.filter((service) =>
        isServiceInProjectDomain(service, source.project.domain),
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

      let domainPddl: string;
      let problemPddl: string;
      try {
        [domainPddl, problemPddl] = toPDDL(source.pddlModel);
      } catch {
        res.status(400).send({
          message: "Project does not contain a valid PDDL planning task.",
        });
        return;
      }
      const configuration = {
        horizon: request.horizon,
        encoding: request.encoding,
        abstractTimeSteps: request.abstractTimeSteps,
        stateFacets: request.stateFacets,
      };
      const sourceFingerprint = planPilotSourceFingerprint({
        domainPddl,
        problemPddl,
      });

      const startKey = planPilotStartKey({
        userId: req.user._id,
        projectId: source.project._id,
        serviceId: services[0]._id,
        sourceFingerprint,
        configuration,
      });
      // Mark abandoned STARTING records as failed after the upstream deadline.
      await PlanPilotRunModel.updateOne(
        {
          startKey,
          status: PlanPilotRunStatus.STARTING,
          updatedAt: { $lte: stalePlanPilotStartBefore() },
        },
        {
          $set: {
            status: PlanPilotRunStatus.FAILED,
            error: "PlanPilot session preparation was interrupted.",
          },
          $unset: { startKey: 1 },
        },
      );
      let run;
      try {
        run = await PlanPilotRunModel.create({
          project: source.project._id,
          user: req.user._id,
          service: services[0]._id,
          status: PlanPilotRunStatus.STARTING,
          configuration,
          startKey,
          sourceFingerprint,
        });
      } catch (error) {
        if (!isMongoDuplicateKey(error)) {
          throw error;
        }
        const existingRun = await PlanPilotRunModel.findOne({
          startKey,
          status: PlanPilotRunStatus.STARTING,
        });
        if (!existingRun) {
          throw error;
        }
        res.set("Retry-After", "2");
        res.status(409).send({
          message:
            "Another PlanPilot session for this source is being prepared. Retry to create an independent session.",
          code: "PLANPILOT_SESSION_START_CONFLICT",
          runId: existingRun._id,
        });
        return;
      }

      let createdExternalSessionId: string | undefined;
      try {
        const session = await createPlanPilotSession(services[0], {
          task: { domainPddl, problemPddl },
          configuration,
          source: {
            system: "IPEXCO",
            runId: run._id,
            projectId: source.project._id,
          },
        });
        createdExternalSessionId = session.sessionId;

        const currentSource = await inspectPlanPilotSourceFingerprint(
          source.project._id,
          req.user._id,
        );
        const sourceConflict = planPilotSourceConflict(
          currentSource,
          sourceFingerprint,
        );
        if (sourceConflict) {
          try {
            await stopPlanPilotSession(services[0], session.sessionId);
          } catch (error) {
            if (!isMissingPlanPilotSession(error)) {
              run.externalSessionId = session.sessionId;
              run.status = PlanPilotRunStatus.FAILED;
              run.startKey = undefined;
              run.error = `${sourceConflict.message} The external session still needs cleanup.`;
              await run.save().catch((saveError) => {
                console.error("Could not retain the PlanPilot cleanup record:", saveError);
              });
              sendPlanPilotRouteError(res, error);
              return;
            }
          }
          await PlanPilotRunModel.deleteOne({ _id: run._id });
          res.status(409).send(sourceConflict);
          return;
        }

        run.externalSessionId = session.sessionId;
        run.status = PlanPilotRunStatus.READY;
        run.startKey = undefined;
        run.configuration = session.configuration;
        run.expiresAt = parseExpiresAt(session.expiresAt);
        await run.save();

        await retireSupersededPlanPilotRuns(
          req.user._id,
          source.project._id,
          services[0],
          sourceFingerprint,
        ).catch((error) => {
          console.warn(
            `Could not retire superseded PlanPilot runs: ${sanitizePlanPilotError(error)}`,
          );
        });

        res.status(201).send({
          runId: run._id,
          externalSessionId: session.sessionId,
          status: run.status,
          configuration: session.configuration,
          expiresAt: run.expiresAt,
          hasPlan: session.hasPlan,
          minimumHorizon: session.minimumHorizon,
          selectionRevision: session.selectionRevision,
          solutionCount: session.solutionCount,
          solution: session.solution,
          facets: session.facets,
          reused: false,
        });
      } catch (error) {
        if (createdExternalSessionId) {
          try {
            await stopPlanPilotSession(services[0], createdExternalSessionId);
          } catch (stopError) {
            if (!isMissingPlanPilotSession(stopError)) {
              console.error("Could not clean up a failed PlanPilot session start:", stopError);
            }
          }
        }
        if (!(await planPilotSourceExists(
          req.user._id,
          source.project._id,
        ))) {
          await PlanPilotRunModel.deleteOne({ _id: run._id });
          throw error;
        }
        run.status = PlanPilotRunStatus.FAILED;
        run.startKey = undefined;
        run.error = sanitizePlanPilotError(error);
        await run.save();
        throw error;
      }
    } catch (error) {
      sendPlanPilotRouteError(res, error);
    }
  },
);

async function planPilotSourceExists(
  userId: unknown,
  projectId: unknown,
): Promise<boolean> {
  return Boolean(await ProjectModel.exists({ _id: projectId, user: userId }));
}

planPilotRouter.get(
  "/sessions/:id",
  authAny,
  async (req: AuthenticatedRequest, res) => {
    try {
      const context = await getRunContext(req, res, {
        allowTerminal: true,
        skipServiceLookupForTerminal: true,
      });
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

      if (!context.run.externalSessionId) {
        res.status(200).send(serializeRun(context.run));
        return;
      }

      if (!context.service) {
        res.status(400).send({ message: "PlanPilot service for this run is not available." });
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
      await updatePlanPilotRunExpiry(context.run, response.expiresAt);
      res.status(200).send({
        runId: context.run._id,
        selectionRevision: response.selectionRevision,
        solutionCount: response.solutionCount,
        solution: response.solution,
        facets: response.facets,
      });
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
      await updatePlanPilotRunExpiry(context.run, response.expiresAt);
      res.status(200).send({
        runId: context.run._id,
        selectionRevision: response.selectionRevision,
        solutionCount: response.solutionCount,
        solution: response.solution,
        facets: response.facets,
      });
    } catch (error) {
      await markExpiredIfNeeded(req.params.id, req.user?._id, error);
      sendPlanPilotRouteError(res, error);
    }
  },
);

planPilotRouter.post(
  "/sessions/:id/facets/apply",
  authAny,
  async (req: AuthenticatedRequest, res) => {
    try {
      const context = await getRunContext(req, res);
      if (!context) {
        return;
      }

      const requestData = ApplyPlanPilotFacetsRequestZ.safeParse(req.body);
      if (!requestData.success) {
        res.status(400).send({ message: "Invalid PlanPilot facet batch request." });
        return;
      }

      const response = await applyPlanPilotFacets(
        context.service,
        context.run.externalSessionId!,
        requestData.data,
      );
      await updatePlanPilotRunExpiry(context.run, response.expiresAt);
      res.status(200).send({
        runId: context.run._id,
        selectionRevision: response.selectionRevision,
        solutionCount: response.solutionCount,
        solution: response.solution,
        facets: response.facets,
      });
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
      await updatePlanPilotRunExpiry(context.run, response.expiresAt);
      res.status(200).send({
        runId: context.run._id,
        selectionRevision: response.selectionRevision,
        solutionCount: response.solutionCount,
        result: response.result,
      });
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
      const context = await getRunContext(req, res, { allowTerminal: true });
      if (!context) {
        return;
      }

      if (
        !context.run.externalSessionId
        || context.run.status === PlanPilotRunStatus.STOPPED
        || context.run.status === PlanPilotRunStatus.EXPIRED
      ) {
        res.status(200).send({
          runId: context.run._id,
          externalSessionId: context.run.externalSessionId,
          status: context.run.status,
        });
        return;
      }

      let stoppedExternalSessionId = context.run.externalSessionId;
      try {
        const response = await stopPlanPilotSession(
          context.service,
          context.run.externalSessionId,
        );
        stoppedExternalSessionId = response.sessionId;
      } catch (error) {
        if (!isMissingPlanPilotSession(error)) {
          throw error;
        }
        context.run.status = PlanPilotRunStatus.EXPIRED;
        context.run.error = sanitizePlanPilotError(error);
        await context.run.save();
        res.status(200).send({
          runId: context.run._id,
          externalSessionId: context.run.externalSessionId,
          status: context.run.status,
        });
        return;
      }
      context.run.status = PlanPilotRunStatus.STOPPED;
      await context.run.save();
      res.status(200).send({
        runId: context.run._id,
        externalSessionId: stoppedExternalSessionId,
        status: context.run.status,
      });
    } catch (error) {
      await markExpiredIfNeeded(req.params.id, req.user?._id, error);
      sendPlanPilotRouteError(res, error);
    }
  },
);
