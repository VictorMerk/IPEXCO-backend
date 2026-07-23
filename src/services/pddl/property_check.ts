import { Document } from 'mongoose';
import { DemoModel } from "../../db_schema/demo";
import { IterationStep, PlanRunStatus, StepStatus } from "../../db_schema/iteration_step";
import { PlanProperty, PlanPropertyModel } from "../../db_schema/plan-properties/plan_property";
import { Project, ProjectModel } from "../../db_schema/project";
import { PropertyCheckerRequest } from "../../db_schema/service_communication";
import { Service, ServiceModel, ServiceType } from "../../db_schema/services";
import { callServices } from "../utils";
import { hasValidPlanActions, planPropertyIdSet } from "../plan-result";


export async function checkProperties(iterationStep: IterationStep & Document) {

    console.log('Check which properties are satisfied...')

    if(!iterationStep.plan || !hasValidPlanActions(iterationStep.plan.actions)){
        console.log('[Property Check] Step has no valid plan.')
        console.log(iterationStep.plan);
        iterationStep.status = StepStatus.UNKNOWN;
        if(iterationStep.plan){
            iterationStep.plan.status = PlanRunStatus.FAILED;
            iterationStep.plan.actions = undefined;
        }
        await iterationStep.save();
        return
    }

    const baseURL = process.env.BASE_URL || 'http://host.docker.internal:3000'

    const selectedPropertyIds = planPropertyIdSet([
        ...iterationStep.hardGoals,
        ...iterationStep.softGoals,
    ]);
    const plan_properties = (await PlanPropertyModel.find({ project: iterationStep.project}) as PlanProperty[])
        .filter(pp => pp._id && selectedPropertyIds.has(pp._id.toString()));

    if (plan_properties.length === 0) {
        iterationStep.status = StepStatus.SOLVABLE;
        iterationStep.plan.status = PlanRunStatus.SOLVED;
        iterationStep.plan.satisfied_properties = [];
        await iterationStep.save();
        return;
    }

    let payload: PropertyCheckerRequest = {
        callback: baseURL + '/api/planner/plan-step/checked/' + iterationStep._id,
        id: iterationStep._id,
        model: iterationStep.task.model,
        goals: plan_properties,
        actions: iterationStep.plan?.actions
    }

    let project = await ProjectModel.findById(iterationStep.project) as Project;
    if(!project){
        project = await DemoModel.findById(iterationStep.project) as Project;
    }

    if (!project) {
        console.log('[Property Check] Project does not exist.')
        iterationStep.status = StepStatus.UNKNOWN;
        iterationStep.plan.status = PlanRunStatus.FAILED;
        iterationStep.plan.actions = undefined;
        await iterationStep.save();
        return;
    }

    const services: Service[] = [];
    for(const serviceId of project.settings.services.services) {
        const service = await ServiceModel.findById(serviceId);
        if(service && service.type == ServiceType.PROPERTY_CHECKER){
            services.push(service);
        }
    }

    if (services.length === 0) {
        console.log('[Property Check] No property checker service selected.')
        iterationStep.status = StepStatus.UNKNOWN;
        iterationStep.plan.status = PlanRunStatus.FAILED;
        iterationStep.plan.actions = undefined;
        await iterationStep.save();
        return;
    }

    const success = await callServices(services, JSON.stringify(payload), '/check');
    if(!success){
        iterationStep.status = StepStatus.UNKNOWN;
        iterationStep.plan.status = PlanRunStatus.FAILED;
        iterationStep.plan.actions = undefined;
        await iterationStep.save();
        console.log('[Property Check] No selected planner service reachable.')
        return
    }         

}
