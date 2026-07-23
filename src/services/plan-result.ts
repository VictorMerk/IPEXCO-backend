import { array } from "zod";

import { Action, ActionZ } from "../db_schema/plan-properties/action_set";

const PlanActionsZ = array(ActionZ);

export function hasValidPlanActions(actions: unknown): actions is Action[] {
  return PlanActionsZ.safeParse(actions).success;
}

export function planPropertyIdSet(ids: readonly unknown[]): Set<string> {
  return new Set(ids.map((id) => String(id)));
}
