import { Service, ServiceType } from "../db_schema/services";

export function defaultServiceIds(services: Service[]): string[] {
  const result: string[] = [];
  let hasPlanPilot = false;
  for (const service of services) {
    if (service.type === ServiceType.PLANPILOT) {
      if (hasPlanPilot) {
        continue;
      }
      hasPlanPilot = true;
    }
    result.push(service._id.toString());
  }
  return result;
}
