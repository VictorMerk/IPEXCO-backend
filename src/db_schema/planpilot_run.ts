import mongoose, { Schema } from "mongoose";
import { coerce, date, nativeEnum, object, string, infer as zinfer } from "zod";
import { PlanPilotSessionConfigurationZ } from "./service_communication";

export enum PlanPilotRunStatus {
  CREATED = "CREATED",
  STARTING = "STARTING",
  READY = "READY",
  FAILED = "FAILED",
  EXPIRED = "EXPIRED",
  STOPPED = "STOPPED",
}

export const PlanPilotRunStatusZ = nativeEnum(PlanPilotRunStatus);

export const PlanPilotRunZ = object({
  _id: string(),
  project: string(),
  user: string(),
  iterationStep: string(),
  service: string(),
  externalSessionId: string().nullish(),
  startKey: string().nullish(),
  sourceFingerprint: string().length(64).optional(),
  status: PlanPilotRunStatusZ,
  configuration: PlanPilotSessionConfigurationZ,
  error: string().nullish(),
  expiresAt: date().nullish(),
  createdAt: coerce.date(),
  updatedAt: coerce.date(),
});

export type PlanPilotRun = zinfer<typeof PlanPilotRunZ>;

const PlanPilotRunSchema = new Schema(
  {
    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "base-project",
      required: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    iterationStep: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "iteration-step",
      required: true,
      index: true,
    },
    service: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "services",
      required: true,
      index: true,
    },
    externalSessionId: { type: String, required: false, index: true },
    // The partial unique index prevents duplicate in-flight session starts.
    startKey: { type: String, required: false },
    sourceFingerprint: { type: String, required: false, index: true },
    status: {
      type: String,
      required: true,
      enum: Object.values(PlanPilotRunStatus),
    },
    configuration: {
      horizon: { type: Number, required: true },
      encoding: { type: String, required: true },
      abstractTimeSteps: { type: Boolean, required: true },
    },
    error: { type: String, required: false },
    expiresAt: { type: Date, required: false },
  },
  { timestamps: true },
);

PlanPilotRunSchema.index({ project: 1, user: 1, service: 1 });
PlanPilotRunSchema.index({ iterationStep: 1, user: 1 });
PlanPilotRunSchema.index({ externalSessionId: 1, service: 1 });
PlanPilotRunSchema.index(
  { startKey: 1 },
  {
    unique: true,
    partialFilterExpression: { startKey: { $type: "string" } },
  },
);
PlanPilotRunSchema.index({ status: 1, expiresAt: 1 });

export const PlanPilotRunModel = mongoose.model<PlanPilotRun>(
  "planpilot-runs",
  PlanPilotRunSchema,
);
