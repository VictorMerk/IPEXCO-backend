import {
  any,
  array,
  boolean,
  enum as zenum,
  nativeEnum,
  number,
  object,
  optional,
  string,
  unknown,
  ZodIssueCode,
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

const PlannerResultZ = object({
  id: string(),
  status: PlanRunStatusZ,
  actions: array(ActionZ),
  runtime: number().optional(), // in sec
});

export const PlannerResponseZ = PlannerResultZ;

export type PlannerResponse = zinfer<typeof PlannerResponseZ>;

export const SimplePlannerRequestZ = object({
  id: string(),
  callback: string(),
  model: any(),
});

export type SimplePlannerRequest = zinfer<typeof SimplePlannerRequestZ>;

export const SimplePlannerResponseZ = PlannerResultZ;

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
  positive: number().nonnegative().safe().nullable(),
  negative: number().nonnegative().safe().nullable(),
});

export const PlanPilotFacetMetricsZ = object({
  solution: PlanPilotFacetMetricPairZ,
  facets: PlanPilotFacetMetricPairZ,
});

export const PlanPilotFacetZ = object({
  id: string().trim().min(1),
  label: string().trim().min(1),
  timestep: number().int().positive().nullable(),
  selectionState: PlanPilotFacetSelectionStateZ,
  action: object({
    name: string().trim().min(1),
    arguments: array(string()),
  }).optional(),
  abstractTimeStep: boolean().optional(),
  selectable: boolean().optional(),
  facetType: optional(zenum(["plan", "selected", "implied", "optional", "empty"])),
  parentId: optional(string().trim().min(1)),
  impliedBy: optional(array(string().trim().min(1))),
  causedBy: optional(string().trim().min(1)),
  reduction: PlanPilotFacetMetricsZ.optional(),
  remaining: PlanPilotFacetMetricsZ.optional(),
});

export type PlanPilotFacet = zinfer<typeof PlanPilotFacetZ>;

export const PlanPilotSolutionZ = object({
  label: string().trim().min(1),
  facets: array(PlanPilotFacetZ),
}).superRefine((solution, context) => {
  const ordered = [...solution.facets].sort((left, right) => (
    (left.timestep ?? Number.MAX_SAFE_INTEGER)
      - (right.timestep ?? Number.MAX_SAFE_INTEGER)
    || left.id.localeCompare(right.id)
  ));

  ordered.forEach((facet, index) => {
    if (facet.timestep === null) {
      context.addIssue({
        code: ZodIssueCode.custom,
        path: ["facets", solution.facets.indexOf(facet), "timestep"],
        message: "Solution facets must have a concrete timestep.",
      });
      return;
    }
    if (index === 0 && facet.parentId !== undefined) {
      context.addIssue({
        code: ZodIssueCode.custom,
        path: ["facets", solution.facets.indexOf(facet), "parentId"],
        message: "The first solution facet must not have a parentId.",
      });
    }
    if (index > 0) {
      const previous = ordered[index - 1];
      if (previous.timestep === null || previous.timestep >= facet.timestep) {
        context.addIssue({
          code: ZodIssueCode.custom,
          path: ["facets", solution.facets.indexOf(facet), "timestep"],
          message: "Solution facet timesteps must increase.",
        });
      }
      if (facet.parentId !== previous.id) {
        context.addIssue({
          code: ZodIssueCode.custom,
          path: ["facets", solution.facets.indexOf(facet), "parentId"],
          message: "Solution parentId must reference the previous solution facet.",
        });
      }
    }
  });
});

export const MAX_PLANPILOT_HORIZON = 100;

export const PlanPilotSessionConfigurationZ = object({
  horizon: number().int().positive().max(MAX_PLANPILOT_HORIZON),
  encoding: PlanPilotEncodingZ,
  abstractTimeSteps: boolean(),
});

export type PlanPilotSessionConfiguration = zinfer<
  typeof PlanPilotSessionConfigurationZ
>;

export const CreatePlanPilotSessionRequestZ = object({
  task: object({
    domainPddl: string().trim().min(1).max(1_000_000),
    problemPddl: string().trim().min(1).max(1_000_000),
  }),
  configuration: PlanPilotSessionConfigurationZ,
  representativePlan: array(ActionZ).min(1).optional(),
  source: object({
    system: zenum(["IPEXCO"]),
    runId: string().optional(),
    projectId: string().optional(),
    iterationStepId: string().optional(),
  }),
});

export type CreatePlanPilotSessionRequest = zinfer<
  typeof CreatePlanPilotSessionRequestZ
>;

export const CreatePlanPilotSessionResponseZ = object({
  sessionId: string().trim().min(1),
  status: zenum(["ready"]),
  configuration: PlanPilotSessionConfigurationZ,
  createdAt: string().datetime({ offset: true }),
  lastAccessAt: string().datetime({ offset: true }),
  expiresAt: string().datetime({ offset: true }),
  hasPlan: boolean(),
  minimumHorizon: number().int().positive().nullable(),
  solution: PlanPilotSolutionZ.nullable(),
  facets: array(PlanPilotFacetZ),
});

export type CreatePlanPilotSessionResponse = zinfer<
  typeof CreatePlanPilotSessionResponseZ
>;

export const ListPlanPilotFacetsResponseZ = object({
  sessionId: string().trim().min(1),
  expiresAt: string().datetime({ offset: true }),
  facets: array(PlanPilotFacetZ),
});

export type ListPlanPilotFacetsResponse = zinfer<
  typeof ListPlanPilotFacetsResponseZ
>;

export const SelectPlanPilotFacetRequestZ = object({
  facetId: string().trim().min(1),
  selectionState: PlanPilotFacetSelectionStateZ,
  previousSelectionState: PlanPilotFacetSelectionStateZ.optional(),
});

export type SelectPlanPilotFacetRequest = zinfer<
  typeof SelectPlanPilotFacetRequestZ
>;

export const ApplyPlanPilotFacetsRequestZ = object({
  selections: array(SelectPlanPilotFacetRequestZ).min(1).max(50),
}).superRefine((request, context) => {
  const seenFacetIds = new Set<string>();
  request.selections.forEach((selection, index) => {
    if (seenFacetIds.has(selection.facetId)) {
      context.addIssue({
        code: ZodIssueCode.custom,
        path: ["selections", index, "facetId"],
        message: "Each facetId may occur only once.",
      });
    }
    seenFacetIds.add(selection.facetId);
  });
});

export type ApplyPlanPilotFacetsRequest = zinfer<
  typeof ApplyPlanPilotFacetsRequestZ
>;

export const SelectPlanPilotFacetResponseZ = object({
  sessionId: string().trim().min(1),
  expiresAt: string().datetime({ offset: true }),
  facets: array(PlanPilotFacetZ),
});

export type SelectPlanPilotFacetResponse = zinfer<
  typeof SelectPlanPilotFacetResponseZ
>;

export const ApplyPlanPilotFacetsResponseZ = SelectPlanPilotFacetResponseZ;
export type ApplyPlanPilotFacetsResponse = SelectPlanPilotFacetResponse;

export const PlanPilotQueryTypeZ = zenum([
  "facets",
  "facetCount",
  "facetReduction",
  "solution",
  "solutionCount",
  "solutionReduction",
]);
export type PlanPilotQueryType = zinfer<typeof PlanPilotQueryTypeZ>;

export const PlanPilotQueryResultZ = object({
  type: PlanPilotQueryTypeZ,
  value: number().int().nonnegative().safe().optional(),
  facets: array(PlanPilotFacetZ).optional(),
  solutions: array(PlanPilotSolutionZ).optional(),
}).superRefine((result, context) => {
  if (
    (result.type === "facetCount" || result.type === "solutionCount") &&
    result.value === undefined
  ) {
    context.addIssue({
      code: ZodIssueCode.custom,
      path: ["value"],
      message: `${result.type} must return value.`,
    });
  }
  if (
    (result.type === "facets" ||
      result.type === "facetReduction" ||
      result.type === "solutionReduction") &&
    result.facets === undefined
  ) {
    context.addIssue({
      code: ZodIssueCode.custom,
      path: ["facets"],
      message: `${result.type} must return facets.`,
    });
  }
  if (result.type === "solution" && result.solutions === undefined) {
    context.addIssue({
      code: ZodIssueCode.custom,
      path: ["solutions"],
      message: "solution must return solutions.",
    });
  }
});

export type PlanPilotQueryResult = zinfer<typeof PlanPilotQueryResultZ>;

export const QueryPlanPilotSessionRequestZ = object({
  type: PlanPilotQueryTypeZ,
  solutionNumber: number().int().positive().optional(),
}).superRefine((request, context) => {
  if (request.type !== "solution" && request.solutionNumber !== undefined) {
    context.addIssue({
      code: ZodIssueCode.custom,
      path: ["solutionNumber"],
      message: "solutionNumber is only supported for solution queries.",
    });
  }
});

export type QueryPlanPilotSessionRequest = zinfer<
  typeof QueryPlanPilotSessionRequestZ
>;

export const QueryPlanPilotSessionResponseZ = object({
  sessionId: string().trim().min(1),
  expiresAt: string().datetime({ offset: true }),
  result: PlanPilotQueryResultZ,
});

export type QueryPlanPilotSessionResponse = zinfer<
  typeof QueryPlanPilotSessionResponseZ
>;

export const GetPlanPilotSessionResponseZ = object({
  sessionId: string().trim().min(1),
  status: zenum(["ready"]),
  configuration: PlanPilotSessionConfigurationZ,
  createdAt: string().datetime({ offset: true }),
  lastAccessAt: string().datetime({ offset: true }),
  expiresAt: string().datetime({ offset: true }),
  hasPlan: boolean(),
  minimumHorizon: number().int().positive().nullable(),
  solution: PlanPilotSolutionZ.nullable(),
});

export type GetPlanPilotSessionResponse = zinfer<
  typeof GetPlanPilotSessionResponseZ
>;

export const StopPlanPilotSessionResponseZ = object({
  sessionId: string().trim().min(1),
  status: zenum(["stopped"]),
});

export type StopPlanPilotSessionResponse = zinfer<
  typeof StopPlanPilotSessionResponseZ
>;
