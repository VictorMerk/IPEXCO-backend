import express from 'express';
import { authAny, authService } from '../middleware/auth';

import { DemoModel } from '../db_schema/demo';
import { IterationStepModel, PlanRunStatus, StepStatus } from '../db_schema/iteration_step';
import { GoalType, PlanProperty, PlanPropertyModel } from '../db_schema/plan-properties/plan_property';
import { Project, ProjectModel } from '../db_schema/project';
import { PlannerRequest, PlannerResponse, PropertyCheckerResponseZ, PropertyCheckRunStatus } from '../db_schema/service_communication';
import { Service, ServiceModel, ServiceType } from '../db_schema/services';
import { checkProperties } from '../services/pddl/property_check';
import { callServices } from '../services/utils';

export const plannerRouter = express.Router();

plannerRouter.post('/plan-step/:id', authAny, async (req: any, res) => {

    try {

        const refId = req.params.id;
        console.log('Compute plan of: ' + refId)
        const iterationStep = await IterationStepModel.findOne({ _id: refId});

        if (iterationStep == null) {
            console.log('[Plan Computation] Iteration Step does not exist.')
            res.status(404).send({status: false, message:'Iteration step does not exist.'});
            return;
        }

        iterationStep.plan = {
            createdAt: new Date(Date.now()),
            status: PlanRunStatus.RUNNING
        }
        await iterationStep.save();
        
        const model = iterationStep.task.model
        const plan_properties = await PlanPropertyModel.find({ project: iterationStep.project}) as PlanProperty[];

        const enforced_goals = plan_properties.filter(pp => !pp._id ? false : iterationStep.hardGoals.includes(pp._id?.toString()));
        const planner_goals = enforced_goals.length > 0 ? enforced_goals : taskGoalProperties(iterationStep);

        const baseURL = process.env.BASE_URL || 'http://host.docker.internal:3000'
        let payload: PlannerRequest = {
            callback:baseURL + '/api/planner/plan-step/finished/' + refId,
            model: model,
            goals: planner_goals,
            hardGoals: planner_goals.map(pp => pp._id).filter(pp => pp !== undefined),
            softGoals: [],
            id: iterationStep._id
        }

        let project = await ProjectModel.findById(iterationStep.project) as Project;
        if(!project){
            project = await DemoModel.findById(iterationStep.project) as Project;
        }

        if (!project) {
            console.log('[Plan Computation] Project does not exist.')
            iterationStep.plan.status = PlanRunStatus.FAILED;
            await iterationStep.save();
            res.status(200).send({status: false, message:'Project does not exists.'});
            return;
        }

        const services: Service[] = [];
        for(const serviceId of project.settings.services.services) {
            const service = await ServiceModel.findById(serviceId);
            if(service && service.type == ServiceType.PLANNER){
                services.push(service);
            }
        }

        if (services.length === 0) {
            console.log('[Plan Computation] No planner service selected.')
            iterationStep.plan.status = PlanRunStatus.FAILED;
            await iterationStep.save();
            res.status(200).send({status: false, message: 'No existing planner service selected.'});
            return;
        }

        const success = await callServices(services, JSON.stringify(payload), '/plan');
        if(!success){
            iterationStep.plan.status = PlanRunStatus.FAILED;
            await iterationStep.save();
            console.log('[Plan Computation] No selected planner service reachable.')
            res.status(201).send({status: false, message:'No selected planner service reachable.'});
            return;
        }

        res.status(201).send({status: true, message:'Plan computation registered'});

    } catch (ex : any) {
        console.log(ex);
        res.status(404).send(ex.message);
    }
});

function taskGoalProperties(iterationStep: any): PlanProperty[] {
    const goalFacts = iterationStep.task?.model?.goal ?? [];
    return goalFacts.map((fact: { name: string; arguments: string[] }, index: number) => {
        const formula = `${fact.name}(${(fact.arguments ?? []).join(',')})`;
        return {
            _id: `__pddl_goal_${index}`,
            project: iterationStep.project?.toString(),
            name: formula,
            definition: null,
            type: GoalType.goalFact,
            formula,
            actionSets: [],
            naturalLanguageDescription: `PDDL task goal ${formula}.`,
            isUsed: true,
            globalHardGoal: true,
            utility: 1,
            color: '#2f6f73',
            icon: 'flag',
            class: 'pddl-task-goal',
        } as PlanProperty;
    });
}


plannerRouter.post('/plan-step/finished/:id', authService, async (req: any, res) => {

    try {

        // console.log(req.body)
        const refId = req.params.id;
        const iterationStep = await IterationStepModel.findOne({ _id: refId});

        if (!iterationStep) {
            res.status(404).send('update step failed');
            return;
        }

        if (!iterationStep.plan) {
            res.status(404).send('update plan failed');
            return;
        }

        if (iterationStep.plan.status == PlanRunStatus.CANCELED) {
            res.status(200).send('Plan run was canceled.');
            return;
        }

        if (iterationStep.plan.status == PlanRunStatus.UNSOLVABLE || 
            iterationStep.plan.status == PlanRunStatus.FAILED 
            // TODO we could update failed runs if multiple planner run in parallel
        ) {
            console.log('Got repeated response for plan call: ' + iterationStep._id);
            res.status(200).send('Plan run already set.');
            return;
        }

        const response = req.body as PlannerResponse;
        const actions = response.actions;
        const status = response.status;

        if(status === PlanRunStatus.NO_PLAN_FOUND){
            iterationStep.status = StepStatus.UNKNOWN
            iterationStep.plan.status = PlanRunStatus.NO_PLAN_FOUND;
            await iterationStep.save();
        }

        if(status === PlanRunStatus.UNSOLVABLE){
            iterationStep.status = StepStatus.UNSOLVABLE
            iterationStep.plan.status = PlanRunStatus.UNSOLVABLE;
            await iterationStep.save();
        }

        if(status === PlanRunStatus.FAILED){
            iterationStep.status = StepStatus.UNKNOWN;
            iterationStep.plan.status = PlanRunStatus.FAILED;
            await iterationStep.save();
        }

        if(status === PlanRunStatus.SOLVED){
            iterationStep.status = StepStatus.SOLVABLE;
            iterationStep.plan.actions = actions;
            iterationStep.plan.satisfied_properties = undefined
            await iterationStep.save()
            checkProperties(iterationStep);
        }
        
        res.status(200).send();
        return;

    } catch (ex : any) {
        console.log(ex);
        res.status(404).send(ex.message);
    }
});




plannerRouter.post('/plan-step/checked/:id', authService, async (req: any, res) => {

    try {

        // console.log(req.body)
        const refId = req.params.id;
        const iterationStep = await IterationStepModel.findOne({ _id: refId});

        if (!iterationStep) {
            res.status(404).send('update step failed');
            return;
        }

        if (!iterationStep.plan) {
            res.status(404).send('update plan failed');
            return;
        }

        if (iterationStep.plan.status == PlanRunStatus.CANCELED) {
            res.status(200).send('Plan run was canceled.');
            return;
        }

        if (iterationStep.plan.status == PlanRunStatus.UNSOLVABLE || 
            iterationStep.plan.status == PlanRunStatus.SOLVED || 
            iterationStep.plan.status == PlanRunStatus.FAILED 
        ) {
            console.log('Got repeated response for check call: ' + iterationStep._id);
            res.status(200).send('Plan run already checked.');
            return;
        }

        const response = PropertyCheckerResponseZ.parse(req.body);
        const status = response.status;
        const satisfiedProperties = response.satisfiedProperties;

        if(status === PropertyCheckRunStatus.CANCELED || 
            status == PropertyCheckRunStatus.FAILED ||
            satisfiedProperties === null
        ){
            iterationStep.status = StepStatus.UNKNOWN;
            iterationStep.plan.status = PlanRunStatus.FAILED;
            iterationStep.plan.actions = undefined;
            await iterationStep.save();
            res.status(200).send();
            return;
        }

        if(status === PropertyCheckRunStatus.FINISHED){
            iterationStep.status = StepStatus.SOLVABLE;
            iterationStep.plan.status = PlanRunStatus.SOLVED;
            
            console.log('Enforced Properties')
            console.log(iterationStep.hardGoals);
            console.log('Satisfied Properties');
            console.log(satisfiedProperties);
    
            // Check all enforced goals also satisfied
            if(! iterationStep.hardGoals.map(id => id.toString()).every(id => satisfiedProperties.includes(id))){
                iterationStep.plan.status = PlanRunStatus.FAILED
                iterationStep.status = StepStatus.UNKNOWN;
                await iterationStep.save();
                throw Error('Not all enforced goals are identified as satisfied by the property checker!');
            }

            iterationStep.plan.satisfied_properties =  satisfiedProperties.filter(id => id != undefined);

            await iterationStep.save()
        
        }
        res.status(200).send();
        return;

    } catch (ex : any) {
        console.log(ex);
        res.status(404).send(ex.message);
    }
});
