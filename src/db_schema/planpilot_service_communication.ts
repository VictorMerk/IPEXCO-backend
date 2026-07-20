import {
  array,
  boolean,
  enum as zenum,
  number,
  object,
  optional,
  string,
  ZodIssueCode,
  infer as zinfer,
} from "zod";
import { ActionZ } from "./plan-properties/action_set";

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

export const PlanPilotFacetReductionPairZ = object({
  positive: number().min(0).max(1).nullable(),
  negative: number().min(0).max(1).nullable(),
});

export const PlanPilotFacetRemainingPairZ = object({
  positive: number().int().nonnegative().safe().nullable(),
  negative: number().int().nonnegative().safe().nullable(),
});

export const PlanPilotFacetReductionMetricsZ = object({
  solution: PlanPilotFacetReductionPairZ,
  facets: PlanPilotFacetReductionPairZ,
});

export const PlanPilotFacetRemainingMetricsZ = object({
  solution: PlanPilotFacetRemainingPairZ,
  facets: PlanPilotFacetRemainingPairZ,
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
  reduction: PlanPilotFacetReductionMetricsZ.optional(),
  remaining: PlanPilotFacetRemainingMetricsZ.optional(),
}).superRefine((facet, context) => {
  const isAbstract = facet.abstractTimeStep === true;
  if (isAbstract !== (facet.timestep === null)) {
    context.addIssue({
      code: ZodIssueCode.custom,
      path: ["timestep"],
      message: "Abstract facets must use a null timestep; concrete facets must use a positive timestep.",
    });
  }
  if (
    facet.facetType === "implied"
    && (facet.selectionState !== "neutral" || facet.selectable !== false)
  ) {
    context.addIssue({
      code: ZodIssueCode.custom,
      path: ["selectionState"],
      message: "Implied facets must be neutral and read-only.",
    });
  }
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
    const sourceIndex = solution.facets.indexOf(facet);
    if (facet.timestep === null) {
      context.addIssue({
        code: ZodIssueCode.custom,
        path: ["facets", sourceIndex, "timestep"],
        message: "Solution facets must have a concrete timestep.",
      });
      return;
    }
    if (index === 0 && facet.parentId !== undefined) {
      context.addIssue({
        code: ZodIssueCode.custom,
        path: ["facets", sourceIndex, "parentId"],
        message: "The first solution facet must not have a parentId.",
      });
    }
    if (index > 0) {
      const previous = ordered[index - 1];
      if (previous.timestep === null || previous.timestep >= facet.timestep) {
        context.addIssue({
          code: ZodIssueCode.custom,
          path: ["facets", sourceIndex, "timestep"],
          message: "Solution facet timesteps must increase.",
        });
      }
      if (facet.parentId !== previous.id) {
        context.addIssue({
          code: ZodIssueCode.custom,
          path: ["facets", sourceIndex, "parentId"],
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
    iterationStepId: string().optional().describe(
      "Legacy source metadata; project-based PlanPilot sessions do not set it.",
    ),
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
  selectionRevision: number().int().nonnegative().safe(),
  solutionCount: number().int().positive().safe().nullable(),
  solution: PlanPilotSolutionZ.nullable(),
  facets: array(PlanPilotFacetZ),
});
export type CreatePlanPilotSessionResponse = zinfer<
  typeof CreatePlanPilotSessionResponseZ
>;

export const ListPlanPilotFacetsResponseZ = object({
  sessionId: string().trim().min(1),
  expiresAt: string().datetime({ offset: true }),
  selectionRevision: number().int().nonnegative().safe(),
  solutionCount: number().int().positive().safe().nullable(),
  solution: PlanPilotSolutionZ.nullable(),
  facets: array(PlanPilotFacetZ),
});
export type ListPlanPilotFacetsResponse = zinfer<
  typeof ListPlanPilotFacetsResponseZ
>;

const PlanPilotFacetSelectionZ = object({
  facetId: string().trim().min(1),
  selectionState: PlanPilotFacetSelectionStateZ,
  previousSelectionState: PlanPilotFacetSelectionStateZ.optional(),
});

export const SelectPlanPilotFacetRequestZ = PlanPilotFacetSelectionZ.extend({
  expectedSelectionRevision: number().int().nonnegative().safe().optional(),
});
export type SelectPlanPilotFacetRequest = zinfer<
  typeof SelectPlanPilotFacetRequestZ
>;

export const ApplyPlanPilotFacetsRequestZ = object({
  selections: array(PlanPilotFacetSelectionZ).min(1).max(50),
  expectedSelectionRevision: number().int().nonnegative().safe().optional(),
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

export const PlanPilotSelectionMutationResponseZ = object({
  sessionId: string().trim().min(1),
  expiresAt: string().datetime({ offset: true }),
  selectionRevision: number().int().nonnegative().safe(),
  solutionCount: number().int().positive().safe().nullable(),
  solution: PlanPilotSolutionZ,
  facets: array(PlanPilotFacetZ),
});
export const SelectPlanPilotFacetResponseZ = PlanPilotSelectionMutationResponseZ;
export type SelectPlanPilotFacetResponse = zinfer<
  typeof SelectPlanPilotFacetResponseZ
>;
export const ApplyPlanPilotFacetsResponseZ = PlanPilotSelectionMutationResponseZ;
export type ApplyPlanPilotFacetsResponse = zinfer<
  typeof ApplyPlanPilotFacetsResponseZ
>;

export const PlanPilotQueryTypeZ = zenum([
  "facets",
  "facetCount",
  "facetReduction",
  "impliedFacets",
  "solution",
  "solutionCount",
  "solutionReduction",
  "selectionImpact",
]);
export type PlanPilotQueryType = zinfer<typeof PlanPilotQueryTypeZ>;

export const PlanPilotSelectionImpactDirectionZ = object({
  available: boolean(),
  plansRemaining: number().int().nonnegative().safe().nullable(),
  planReduction: number().min(0).max(1).nullable(),
});

export const PlanPilotSelectionImpactZ = object({
  facetId: string().trim().min(1),
  exact: boolean(),
  comparableToCurrent: boolean(),
  totalPlans: number().int().positive().safe().nullable(),
  require: PlanPilotSelectionImpactDirectionZ,
  forbid: PlanPilotSelectionImpactDirectionZ,
});

export const PlanPilotQueryResultZ = object({
  type: PlanPilotQueryTypeZ,
  value: number().int().nonnegative().safe().optional(),
  facets: array(PlanPilotFacetZ).optional(),
  solutions: array(PlanPilotSolutionZ).optional(),
  facetId: string().trim().min(1).optional(),
  exact: boolean().optional(),
  comparableToCurrent: boolean().optional(),
  totalPlans: number().int().positive().safe().nullable().optional(),
  require: PlanPilotSelectionImpactDirectionZ.optional(),
  forbid: PlanPilotSelectionImpactDirectionZ.optional(),
}).superRefine((result, context) => {
  if (
    (result.type === "facetCount" || result.type === "solutionCount")
    && result.value === undefined
  ) {
    context.addIssue({
      code: ZodIssueCode.custom,
      path: ["value"],
      message: `${result.type} must return value.`,
    });
  }
  if (result.type === "solutionCount" && (result.value ?? 0) < 1) {
    context.addIssue({
      code: ZodIssueCode.custom,
      path: ["value"],
      message: "solutionCount must be positive.",
    });
  }
  if (
    ["facets", "facetReduction", "impliedFacets", "solutionReduction"].includes(
      result.type,
    )
    && result.facets === undefined
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
  if (
    result.type === "selectionImpact"
    && (
      result.facetId === undefined
      || result.exact === undefined
      || result.comparableToCurrent === undefined
      || result.totalPlans === undefined
      || result.require === undefined
      || result.forbid === undefined
    )
  ) {
    context.addIssue({
      code: ZodIssueCode.custom,
      message: "selectionImpact must return its complete impact result.",
    });
  }
  if (result.type === "facetReduction" || result.type === "solutionReduction") {
    result.facets?.forEach((facet, index) => {
      if (facet.reduction === undefined || facet.remaining === undefined) {
        context.addIssue({
          code: ZodIssueCode.custom,
          path: ["facets", index],
          message: `${result.type} facets must include reduction and remaining metrics.`,
        });
      }
    });
  }
  if (result.type === "impliedFacets") {
    result.facets?.forEach((facet, index) => {
      if (facet.facetType !== "implied") {
        context.addIssue({
          code: ZodIssueCode.custom,
          path: ["facets", index, "facetType"],
          message: "impliedFacets may contain implied facets only.",
        });
      }
    });
  }
});
export type PlanPilotQueryResult = zinfer<typeof PlanPilotQueryResultZ>;

export const QueryPlanPilotSessionRequestZ = object({
  type: PlanPilotQueryTypeZ,
  solutionNumber: number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  facetId: string().trim().min(1).optional(),
}).superRefine((request, context) => {
  if (request.type !== "solution" && request.solutionNumber !== undefined) {
    context.addIssue({
      code: ZodIssueCode.custom,
      path: ["solutionNumber"],
      message: "solutionNumber is only supported for solution queries.",
    });
  }
  if (request.type === "solution" && request.solutionNumber === undefined) {
    context.addIssue({
      code: ZodIssueCode.custom,
      path: ["solutionNumber"],
      message: "solutionNumber is required for solution queries.",
    });
  }
  if (request.type !== "selectionImpact" && request.facetId !== undefined) {
    context.addIssue({
      code: ZodIssueCode.custom,
      path: ["facetId"],
      message: "facetId is only supported for selectionImpact queries.",
    });
  }
  if (request.type === "selectionImpact" && request.facetId === undefined) {
    context.addIssue({
      code: ZodIssueCode.custom,
      path: ["facetId"],
      message: "facetId is required for selectionImpact queries.",
    });
  }
});
export type QueryPlanPilotSessionRequest = zinfer<
  typeof QueryPlanPilotSessionRequestZ
>;

export const QueryPlanPilotSessionResponseZ = object({
  sessionId: string().trim().min(1),
  expiresAt: string().datetime({ offset: true }),
  selectionRevision: number().int().nonnegative().safe(),
  solutionCount: number().int().positive().safe().nullable(),
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
  selectionRevision: number().int().nonnegative().safe(),
  solutionCount: number().int().positive().safe().nullable(),
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
