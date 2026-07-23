import express from 'express';
import { auth, authAny, AuthenticatedRequest } from '../middleware/auth';
import { Project, ProjectBase, ProjectBaseZ, ProjectMetaData, ProjectZ } from './../db_schema/project';

import { DemoModel } from '../db_schema/demo';
import { DomainSpecificationModel } from '../db_schema/domain_specification';
import { IterationStepModel } from '../db_schema/iteration_step';
import { PlanPropertyModel } from '../db_schema/plan-properties/plan_property';
import { ProjectModel } from '../db_schema/project';
import { ServiceModel } from '../db_schema/services';
import { PlanPilotRunCleanupError, removePlanPilotRuns } from '../services/planpilot-run-cleanup';
import { defaultServiceIds } from '../services/project-services';

export const projectRouter = express.Router();



projectRouter.post('/', auth, async (req: AuthenticatedRequest, res) => {
    let projectId = null;;
    try {
        const projectBaseData: ProjectBase = ProjectBaseZ.parse(req.body);

        if (!req.user) {
            res.status(401).send('Create project failed.');
            return;
        }

        const initialServiceIds = await resolveDefaultServiceIds(projectBaseData);

        const projectData : ProjectBase & {user: string} = {
            ...projectBaseData,
            settings: {
                ...projectBaseData.settings,
                services: {
                    ...projectBaseData.settings.services,
                    services: projectBaseData.settings.services.services.length > 0
                        ? projectBaseData.settings.services.services
                        : initialServiceIds,
                }
            },
            user: req.user._id
        }

        const projectModel = new ProjectModel(projectData);

        if (!projectModel) {
            res.status(404).send('Create project failed.');
            return;
        }

        let newProject: Project | null = await projectModel.save();

        if (!newProject) {
            res.status(404).send('Create project failed.');
            return;
        }
        projectId = newProject._id;
        
        res.send(newProject);

    } catch (ex : any) {
        console.log(ex.message);
        if(projectId){
            await ProjectModel.deleteOne({ _id: projectId });
        }
        res.status(500).send();
    }
});

async function resolveDefaultServiceIds(project: ProjectBase): Promise<string[]> {
    const domain = await DomainSpecificationModel.findById(project.domain);
    const services = await ServiceModel.find({
        $and: [
            {
                $or: [
                    { domainId: null },
                    { domainId: { $exists: false } },
                    { domainId: project.domain },
                ],
            },
            domain?.encoding ? { encoding: domain.encoding } : {},
        ],
    }).sort({ _id: 1 });

    return defaultServiceIds(services);
}

projectRouter.put('/:id', auth, async (req: AuthenticatedRequest, res) => {
    try {
        if (!req.user) {
            res.status(401).send();
            return;
        }
        const refId = req.params.id;
        const project = await ProjectModel.findOne({
            _id: refId,
            user: req.user._id,
        });

        if (!project) {
            res.status(404).send('update project failed');
            return;
        }

        const parsedProject = ProjectZ.safeParse(req.body);
        if (!parsedProject.success) {
            res.status(400).send({ message: 'Invalid project update.' });
            return;
        }
        const projectData = parsedProject.data;

        project.name = projectData.name;
        project.description = projectData.description;
        project.settings = projectData.settings;
        project.public = projectData.public;

        await project.save();

        res.send(project);

    } catch (ex : any) {
        console.log(ex.message);
        res.status(500).send();
    }
});


projectRouter.get('', auth, async (req: AuthenticatedRequest, res) => {
    if (!req.user) {
        res.status(401).send();
        return;
    }
    const projects: Project[] = await ProjectModel.find({ user: req.user._id});
    if (!projects) { 
        res.status(404).send({ message: 'No project found.' });
        return;
    }

    res.send(projects);

});

projectRouter.get('/meta-data', auth, async (req: any, res) => {
    if (!req.user) {
        res.status(401).send('Create project failed.');
        return;
    }
    const projects = await ProjectModel.find({ user: req.user._id}) as Project[];
    if (!projects) { 
        res.status(404).send({ message: 'No project found.' });
        return;
    }

    let metaDataList: ProjectMetaData[] = projects.filter(p => p._id !== undefined).
        map(project => ({
                _id: project._id,
                public: project.public,
                name: project.name,
                user: project.user.toString(),
            })
        )   

    res.send(metaDataList);

});



projectRouter.get('/:id', authAny, async (req: AuthenticatedRequest, res) => {
    try {

        if (!req.user) {
            res.status(401).send();
            return;
        }

        const id = req.params.id;

        if (id == null || id == 'null') { 
            res.status(404).send({ message: 'No project found.' });
            return;
        }

        const project = await ProjectModel.findOne({
            _id: id,
            $or: [
                { user: req.user._id },
                { public: true },
            ],
        });
        if (project) { 

            if(req.user.role != 'user-study'){
                res.send(project);
            }
            else{
                res.status(401).send();
            }
            return;
        }

        const demo = await DemoModel.findOne({ _id: id });
        if (demo) { 
            res.send(demo)
            return;
        }

        res.status(404).send({ message: 'No project found.' });
        return;

    } catch (ex : any) {
        console.log(ex);
        res.status(500).send();
    }
});

projectRouter.delete('/meta-data/:id', auth, async (req: AuthenticatedRequest, res) => {
    try {
        if (!req.user) {
            res.status(401).send();
            return;
        }

        const id = req.params.id;

        const project = await ProjectModel.findOne({
            _id: id,
            user: req.user._id,
        });
        if (!project) {
            res.status(404).send({ message: 'No project found.' });
            return;
        }

        await removePlanPilotRuns({
            userId: req.user._id,
            projectId: project._id,
        });
        await IterationStepModel.deleteMany({ project: id});
        await PlanPropertyModel.deleteMany({ project: id});

        // delete project itself
        const projectDeleteResult = await ProjectModel.deleteOne({ _id: id, user: req.user._id });
        if (projectDeleteResult.deletedCount !== 1) {
            res.status(404).send({ message: 'No project found.' });
            return; 
        }

        res.send(true);

    } catch (ex : any) {
        if (ex instanceof PlanPilotRunCleanupError) {
            res.status(ex.status).send({ message: ex.message });
            return;
        }
        console.log(ex);
        res.status(500).send();
    }

});
