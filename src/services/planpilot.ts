import { CreatePlanPilotSessionRequest, CreatePlanPilotSessionResponse, CreatePlanPilotSessionResponseZ } from "../db_schema/service_communication";
import { Service } from "../db_schema/services";

export async function createPlanPilotSession(
	service: Service,
	payload: CreatePlanPilotSessionRequest
): Promise<CreatePlanPilotSessionResponse> {
	const response = await fetch(service.url + "/api/sessions", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			authorization: "Bearer " + service.apiKey,
		},
		body: JSON.stringify(payload),
	});

	if (!response.ok) {
		throw new Error(`PlanPilot session start failed with status ${response.status}.`);
	}

	return CreatePlanPilotSessionResponseZ.parse(await response.json());
}
