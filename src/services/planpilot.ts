import {
  CreatePlanPilotSessionRequest,
  CreatePlanPilotSessionResponse,
  CreatePlanPilotSessionResponseZ,
  GetPlanPilotSessionResponse,
  GetPlanPilotSessionResponseZ,
  ListPlanPilotFacetsResponse,
  ListPlanPilotFacetsResponseZ,
  QueryPlanPilotSessionRequest,
  QueryPlanPilotSessionResponse,
  QueryPlanPilotSessionResponseZ,
  SelectPlanPilotFacetRequest,
  SelectPlanPilotFacetResponse,
  SelectPlanPilotFacetResponseZ,
  StopPlanPilotSessionResponse,
  StopPlanPilotSessionResponseZ,
} from "../db_schema/service_communication";
import { Service } from "../db_schema/services";

const PLANPILOT_TIMEOUT_MS = 30000;

export class PlanPilotClientError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "PlanPilotClientError";
  }
}

export async function createPlanPilotSession(
  service: Service,
  payload: CreatePlanPilotSessionRequest,
): Promise<CreatePlanPilotSessionResponse> {
  return postPlanPilot(
    service,
    "/api/sessions",
    payload,
    CreatePlanPilotSessionResponseZ,
  );
}

export async function listPlanPilotFacets(
  service: Service,
  externalSessionId: string,
): Promise<ListPlanPilotFacetsResponse> {
  return postPlanPilot(
    service,
    `/api/sessions/${encodeURIComponent(externalSessionId)}/facets/list`,
    {},
    ListPlanPilotFacetsResponseZ,
  );
}

export async function getPlanPilotSession(
  service: Service,
  externalSessionId: string,
): Promise<GetPlanPilotSessionResponse> {
  return requestPlanPilot(
    service,
    `/api/sessions/${encodeURIComponent(externalSessionId)}`,
    "GET",
    undefined,
    GetPlanPilotSessionResponseZ,
  );
}

export async function selectPlanPilotFacet(
  service: Service,
  externalSessionId: string,
  payload: SelectPlanPilotFacetRequest,
): Promise<SelectPlanPilotFacetResponse> {
  return postPlanPilot(
    service,
    `/api/sessions/${encodeURIComponent(externalSessionId)}/facets/select`,
    payload,
    SelectPlanPilotFacetResponseZ,
  );
}

export async function queryPlanPilotSession(
  service: Service,
  externalSessionId: string,
  payload: QueryPlanPilotSessionRequest,
): Promise<QueryPlanPilotSessionResponse> {
  return postPlanPilot(
    service,
    `/api/sessions/${encodeURIComponent(externalSessionId)}/query`,
    payload,
    QueryPlanPilotSessionResponseZ,
  );
}

export async function stopPlanPilotSession(
  service: Service,
  externalSessionId: string,
): Promise<StopPlanPilotSessionResponse> {
  return requestPlanPilot(
    service,
    `/api/sessions/${encodeURIComponent(externalSessionId)}`,
    "DELETE",
    undefined,
    StopPlanPilotSessionResponseZ,
  );
}

async function postPlanPilot<T>(
  service: Service,
  path: string,
  payload: unknown,
  schema: { parse: (data: unknown) => T },
): Promise<T> {
  return requestPlanPilot(service, path, "POST", payload, schema);
}

async function requestPlanPilot<T>(
  service: Service,
  path: string,
  method: "GET" | "POST" | "DELETE",
  payload: unknown,
  schema: { parse: (data: unknown) => T },
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PLANPILOT_TIMEOUT_MS);

  try {
    const response = await fetch(buildPlanPilotUrl(service, path), {
      method,
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + service.apiKey,
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
      signal: controller.signal,
    });

    const body = await readJsonBody(response);
    if (!response.ok) {
      throw toPlanPilotClientError(response.status, body);
    }

    return schema.parse(body);
  } catch (error) {
    if (error instanceof PlanPilotClientError) {
      throw error;
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new PlanPilotClientError(
        "PlanPilot service timed out.",
        504,
        "PLANPILOT_TIMEOUT",
      );
    }
    throw new PlanPilotClientError(
      "PlanPilot service is not reachable.",
      502,
      "PLANPILOT_UNREACHABLE",
    );
  } finally {
    clearTimeout(timeout);
  }
}

function buildPlanPilotUrl(service: Service, path: string): string {
  return service.url.replace(/\/+$/, "") + path;
}

async function readJsonBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function toPlanPilotClientError(
  status: number,
  body: unknown,
): PlanPilotClientError {
  if (isPlanPilotErrorBody(body)) {
    return new PlanPilotClientError(
      body.error.message,
      status,
      body.error.code,
    );
  }

  return new PlanPilotClientError(
    `PlanPilot request failed with status ${status}.`,
    status,
    "PLANPILOT_FAILED",
  );
}

function isPlanPilotErrorBody(
  body: unknown,
): body is { error: { code: string; message: string } } {
  if (!body || typeof body !== "object" || !("error" in body)) {
    return false;
  }

  const error = (body as { error?: unknown }).error;
  return Boolean(
    error &&
    typeof error === "object" &&
    typeof (error as { code?: unknown }).code === "string" &&
    typeof (error as { message?: unknown }).message === "string",
  );
}
