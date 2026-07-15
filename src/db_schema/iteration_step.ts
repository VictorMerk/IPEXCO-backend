import mongoose, { Document, Schema } from 'mongoose';
import { array, coerce, date, nativeEnum, object, string, infer as zinfer } from "zod";
import { Explanation, ExplanationSchema, GlobalExplanation, GlobalExplanationSchema, GlobalExplanationZ } from './explanations';
import { PlanningTask, PlanningTaskSchema, PlanningTaskZ } from './planning_task';
import { User } from './user';
import { ActionZ } from './plan-properties/action_set';


export enum StepStatus{
    UNKNOWN = "UNKNOWN",
    SOLVABLE = "SOLVABLE",
    UNSOLVABLE = "UNSOLVABLE",
}

export const StepStatusZ = nativeEnum(StepStatus);

export enum PlanRunStatus {
    PENDING = "PENDING",
    RUNNING = "RUNNING",
    SOLVED = "SOLVED",
    UNSOLVABLE = "UNSOLVABLE",
    NO_PLAN_FOUND = "NO_PLAN_FOUND",
    CANCELED = "CANCELED",
    FAILED = "FAILED",
}

export const PlanRunStatusZ = nativeEnum(PlanRunStatus);

export const PlanZ = object({
    createdAt: date(), 
    status: PlanRunStatusZ,
    actions: array(ActionZ).nullish(),
    satisfied_properties: array(string()).optional(),
});

export type Plan = zinfer<typeof PlanZ>;

const PlanSchema = new Schema({
    status: { type: String, required: true},
    plan: { type: String, required: false},
    satisfied_properties: [{ type: mongoose.Schema.Types.ObjectId, ref: 'plan-property' }],
    actions: { type: Object, required: false},
    createdAt: { type: Date, required: false},
}, { timestamps: true}); 




export const IterationStepBaseZ = object({
	name: string().trim().min(1),
	project: string(),
	status: StepStatusZ,
	hardGoals: array(string()),
	softGoals: array(string()),
	task: PlanningTaskZ,
	plan: PlanZ.optional(),
	globalExplanation: GlobalExplanationZ.optional(),
	predecessorStep: string().nullable(),
});

export type IterationStepBase = zinfer<typeof IterationStepBaseZ>;

export const IterationStepZ = IterationStepBaseZ.merge(object({
    _id: string(),
    user: string(),
    createdAt: coerce.date(),
}));

export type IterationStep = zinfer<typeof IterationStepZ>;

const IterationStepSchema = new Schema({
    name: { type: String, required: true},
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    status: { type: String, required: true},
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'base-project' },
    hardGoals: [{ type: mongoose.Schema.Types.ObjectId, ref: 'plan-property' }],
    softGoals: [{ type: mongoose.Schema.Types.ObjectId, ref: 'plan-property' }],
    task: PlanningTaskSchema,
    plan: PlanSchema,
    globalExplanation: GlobalExplanationSchema,
    explanations: [ExplanationSchema],
    predecessorStep: { type: mongoose.Schema.Types.ObjectId, ref: 'iteration-step', required: false },
}, { timestamps: true});



export const IterationStepModel = mongoose.model<IterationStep>('iteration-step', IterationStepSchema);
