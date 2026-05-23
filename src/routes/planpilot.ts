import express from "express";
import { object, boolean, string } from "zod";

import { PDDLPlanningModel, toPDDL } from "../db_schema/PDDL_task";
import { PlanRunStatus } from "../db_schema/iteration_step";
import { PlanModel } from "../db_schema/plan";
import { ProjectModel } from "../db_schema/project";
import { PlanPilotSessionConfigurationZ } from "../db_schema/service_communication";
import { Service, ServiceModel, ServiceType } from "../db_schema/services";
import { AuthenticatedRequest, authAny } from "../middleware/auth";
import { createPlanPilotSession } from "../services/planpilot";

export const planPilotRouter = express.Router();

const StartPlanPilotSessionZ = object({
	planId: string(),
	horizon: PlanPilotSessionConfigurationZ.shape.horizon,
	encoding: PlanPilotSessionConfigurationZ.shape.encoding,
	abstractTimeSteps: boolean(),
});

planPilotRouter.post("/sessions", authAny, async (req: AuthenticatedRequest, res) => {
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
		const plan = await PlanModel.findOne({ _id: request.planId, user: req.user._id });

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

		const services = await getSelectedPlanPilotServices(project.settings.services.services);
		if (services.length === 0) {
			res.status(400).send({ message: "No PlanPilot service selected." });
			return;
		}

		if (services.length > 1) {
			res.status(400).send({ message: "Select one PlanPilot service for the project." });
			return;
		}

		const [domainPddl, problemPddl] = toPDDL(project.baseTask.model as PDDLPlanningModel);
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

		res.status(201).send(session);
	} catch (error) {
		console.log(error);
		res.status(500).send();
	}
});

async function getSelectedPlanPilotServices(serviceIds: string[]): Promise<Service[]> {
	const services: Service[] = [];

	for (const serviceId of serviceIds) {
		const service = await ServiceModel.findById(serviceId);
		if (service && service.type === ServiceType.PLANPILOT) {
			services.push(service);
		}
	}

	return services;
}
