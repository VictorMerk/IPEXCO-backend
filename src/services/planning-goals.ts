import { PlanProperty } from "../db_schema/plan-properties/plan_property";
import { planPropertyIdSet } from "./plan-result";

export function selectPlanProperties(
  properties: PlanProperty[],
  requestedIds: readonly unknown[],
): { selected: PlanProperty[]; missingIds: string[] } {
  const requested = planPropertyIdSet(requestedIds);
  const byId = new Map(
    properties
      .filter((property) => property._id)
      .map((property) => [property._id!.toString(), property]),
  );

  return {
    selected: [...requested]
      .map((id) => byId.get(id))
      .filter((property): property is PlanProperty => property !== undefined),
    missingIds: [...requested].filter((id) => !byId.has(id)),
  };
}

export function mergePlannerGoals(
  taskGoals: PlanProperty[],
  enforcedGoals: PlanProperty[],
): PlanProperty[] {
  const merged = new Map<string, PlanProperty>();
  for (const goal of taskGoals) {
    merged.set(planPropertyKey(goal), goal);
  }
  for (const goal of enforcedGoals) {
    merged.set(planPropertyKey(goal), goal);
  }
  return [...merged.values()];
}

function planPropertyKey(property: PlanProperty): string {
  if (property.definition) {
    return compactFormula(
      `${property.definition.name}(${property.definition.parameters.join(",")})`,
    );
  }
  if (property.formula) {
    return compactFormula(property.formula);
  }
  return property._id?.toString() ?? property.name;
}

function compactFormula(formula: string): string {
  return formula.replace(/\s+/g, "");
}
