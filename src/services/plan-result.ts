import { array } from "zod";

import { Action, ActionZ } from "../db_schema/plan-properties/action_set";

const PlanActionsZ = array(ActionZ);
const NonEmptyPlanActionsZ = PlanActionsZ.min(1);

export function hasValidPlanActions(actions: unknown): actions is Action[] {
  return PlanActionsZ.safeParse(actions).success;
}

export function hasPlanActions(actions: unknown): actions is Action[] {
  return NonEmptyPlanActionsZ.safeParse(actions).success;
}

export function representativePlanForHorizon(
  actions: unknown,
  horizon: number,
): Action[] | undefined {
  if (!hasPlanActions(actions) || actions.length > horizon) {
    return undefined;
  }
  return actions.map((action) => ({
    name: action.name,
    params: [...action.params],
  }));
}

export function representativePlanForConfiguration(
  actions: unknown,
  horizon: number,
  encoding: "exact" | "bounded",
): Action[] | undefined {
  const plan = representativePlanForHorizon(actions, horizon);
  if (!plan || (encoding === "exact" && plan.length !== horizon)) {
    return undefined;
  }
  return plan;
}

export function planPropertyIdSet(ids: readonly unknown[]): Set<string> {
  return new Set(ids.map((id) => String(id)));
}

export function planPilotPlanValidationMessage(plan: {
  status?: unknown;
  actions?: unknown;
} | null | undefined): string | undefined {
  if (plan?.status !== "SOLVED") {
    return "PlanPilot requires a solved iteration-step plan.";
  }
  if (!hasPlanActions(plan.actions)) {
    return "PlanPilot requires a solved iteration-step plan with at least one valid stored action.";
  }
  return undefined;
}
