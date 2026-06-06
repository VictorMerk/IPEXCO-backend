import {
  any,
  array,
  boolean,
  enum as zenum,
  nativeEnum,
  number,
  object,
  string,
  unknown,
  infer as zinfer,
} from "zod";
import { ExplanationRunStatusZ } from "./explanations";
import { PlanRunStatusZ } from "./iteration_step";
import { Action, ActionZ } from "./plan-properties/action_set";
import { PlanProperty, PlanPropertyZ } from "./plan-properties/plan_property";

export const PlannerRequestZ = object({
  id: string(),
  callback: string(),
  model: any(),
  goals: array(PlanPropertyZ),
  softGoals: array(string()), // ids
  hardGoals: array(string()), // ids
});

export type PlannerRequest = zinfer<typeof PlannerRequestZ>;

export const PlannerResponseZ = object({
  id: string(),
  status: PlanRunStatusZ,
  actions: array(ActionZ),
  runtime: number().optional(), // in sec
});

export type PlannerResponse = zinfer<typeof PlannerResponseZ>;

export const SimplePlannerRequestZ = object({
  id: string(),
  callback: string(),
  model: any(),
});

export type SimplePlannerRequest = zinfer<typeof SimplePlannerRequestZ>;

export const SimplePlannerResponseZ = object({
  id: string(),
  status: PlanRunStatusZ,
  actions: array(ActionZ),
  runtime: number().optional(), // in sec
});

export type SimplePlannerResponse = zinfer<typeof SimplePlannerResponseZ>;

export const ExplainerRequestZ = object({
  id: string(),
  callback: string(),
  model: any(),
  goals: array(PlanPropertyZ),
  softGoals: array(string()), // ids
  hardGoals: array(string()), // ids
});

export type ExplainerRequest = zinfer<typeof ExplainerRequestZ>;

export const ResultZ = object({
  MUGS: object({
    complete: boolean(),
    subsets: array(array(string())), // plan property ids
  }),
  MGCS: object({
    complete: boolean(),
    subsets: array(array(string())), // plan property ids
  }),
});

export type Result = zinfer<typeof ResultZ>;

export const ExplainerResponseZ = object({
  id: string(),
  status: ExplanationRunStatusZ,
  result: ResultZ,
  runtime: number().optional(), // in sec
});

export type ExplainerResponse = zinfer<typeof ExplainerResponseZ>;

export enum PropertyCheckRunStatus {
  PENDING = "PENDING",
  RUNNING = "RUNNING",
  FAILED = "FAILED",
  FINISHED = "FINISHED",
  CANCELED = "CANCELED",
}

export const PropertyCheckRunStatusZ = nativeEnum(PropertyCheckRunStatus);

export const PropertyCheckerRequestZ = object({
  id: string(),
  callback: string(),
  model: unknown(),
  goals: array(PlanPropertyZ),
  actions: array(ActionZ),
});

export type PropertyCheckerRequest = zinfer<typeof PropertyCheckerRequestZ>;

export const PropertyCheckerResponseZ = object({
  id: string(),
  status: PropertyCheckRunStatusZ,
  satisfiedProperties: array(string()).nullable(),
});

export type PropertyCheckerResponse = zinfer<typeof PropertyCheckerResponseZ>;

export const PlanPilotEncodingZ = zenum(["exact", "bounded"]);
export type PlanPilotEncoding = zinfer<typeof PlanPilotEncodingZ>;

export const PlanPilotFacetSelectionStateZ = zenum([
  "neutral",
  "positive",
  "negative",
]);
export type PlanPilotFacetSelectionState = zinfer<
  typeof PlanPilotFacetSelectionStateZ
>;

export const PlanPilotFacetMetricPairZ = object({
  positive: number().nullable(),
  negative: number().nullable(),
});

export const PlanPilotFacetMetricsZ = object({
  solution: PlanPilotFacetMetricPairZ,
  facets: PlanPilotFacetMetricPairZ,
});

export const PlanPilotFacetZ = object({
  id: string(),
  label: string(),
  timestep: number().int().nullable(),
  selectionState: PlanPilotFacetSelectionStateZ,
  reduction: PlanPilotFacetMetricsZ.optional(),
  remaining: PlanPilotFacetMetricsZ.optional(),
});

export type PlanPilotFacet = zinfer<typeof PlanPilotFacetZ>;

export const PlanPilotSessionConfigurationZ = object({
  horizon: number().int().positive(),
  encoding: PlanPilotEncodingZ,
  abstractTimeSteps: boolean(),
});

export type PlanPilotSessionConfiguration = zinfer<
  typeof PlanPilotSessionConfigurationZ
>;

export const CreatePlanPilotSessionRequestZ = object({
  task: object({
    domainPddl: string(),
    problemPddl: string(),
  }),
  configuration: PlanPilotSessionConfigurationZ,
  source: object({
    system: zenum(["IPEXCO"]),
    runId: string().optional(),
    projectId: string().optional(),
    planId: string().optional(),
  }),
});

export type CreatePlanPilotSessionRequest = zinfer<
  typeof CreatePlanPilotSessionRequestZ
>;

export const CreatePlanPilotSessionResponseZ = object({
  sessionId: string(),
  status: zenum(["ready"]),
  configuration: PlanPilotSessionConfigurationZ,
  createdAt: string(),
  lastAccessAt: string(),
  expiresAt: string(),
  facets: array(PlanPilotFacetZ),
});

export type CreatePlanPilotSessionResponse = zinfer<
  typeof CreatePlanPilotSessionResponseZ
>;

export const ListPlanPilotFacetsResponseZ = object({
  sessionId: string(),
  facets: array(PlanPilotFacetZ),
});

export type ListPlanPilotFacetsResponse = zinfer<
  typeof ListPlanPilotFacetsResponseZ
>;

export const SelectPlanPilotFacetRequestZ = object({
  facetId: string(),
  selectionState: PlanPilotFacetSelectionStateZ,
  previousSelectionState: PlanPilotFacetSelectionStateZ.optional(),
});

export type SelectPlanPilotFacetRequest = zinfer<
  typeof SelectPlanPilotFacetRequestZ
>;

export const SelectPlanPilotFacetResponseZ = object({
  sessionId: string(),
  facets: array(PlanPilotFacetZ),
});

export type SelectPlanPilotFacetResponse = zinfer<
  typeof SelectPlanPilotFacetResponseZ
>;

export const PlanPilotQueryTypeZ = zenum([
  "facets",
  "facetCount",
  "facetReduction",
  "solution",
  "solutionCount",
  "solutionReduction",
]);
export type PlanPilotQueryType = zinfer<typeof PlanPilotQueryTypeZ>;

export const PlanPilotSolutionZ = object({
  label: string(),
  facets: array(PlanPilotFacetZ),
});

export const PlanPilotQueryResultZ = object({
  type: PlanPilotQueryTypeZ,
  value: number().optional(),
  facets: array(PlanPilotFacetZ).optional(),
  solutions: array(PlanPilotSolutionZ).optional(),
});

export type PlanPilotQueryResult = zinfer<typeof PlanPilotQueryResultZ>;

export const QueryPlanPilotSessionRequestZ = object({
  type: PlanPilotQueryTypeZ,
  solutionNumber: number().int().positive().optional(),
});

export type QueryPlanPilotSessionRequest = zinfer<
  typeof QueryPlanPilotSessionRequestZ
>;

export const QueryPlanPilotSessionResponseZ = object({
  sessionId: string(),
  result: PlanPilotQueryResultZ,
});

export type QueryPlanPilotSessionResponse = zinfer<
  typeof QueryPlanPilotSessionResponseZ
>;

export const GetPlanPilotSessionResponseZ = object({
  sessionId: string(),
  status: zenum(["ready"]),
  configuration: PlanPilotSessionConfigurationZ,
  createdAt: string(),
  lastAccessAt: string(),
  expiresAt: string(),
});

export type GetPlanPilotSessionResponse = zinfer<
  typeof GetPlanPilotSessionResponseZ
>;

export const StopPlanPilotSessionResponseZ = object({
  sessionId: string(),
  status: zenum(["stopped"]),
});

export type StopPlanPilotSessionResponse = zinfer<
  typeof StopPlanPilotSessionResponseZ
>;
