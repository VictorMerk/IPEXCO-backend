import mongoose, { Schema } from 'mongoose';
import { nativeEnum, nullable, object, string, infer as zinfer } from "zod";

export enum ServiceType {
    PLANNER = 'PLANNER',
    EXPLAINER = 'EXPLAINER',
    PROPERTY_CHECKER = 'PROPERTY_CHECKER',
    PLANPILOT = 'PLANPILOT',
    TESTER = 'TESTER',
    VERIFIER = 'VERIFIER',
    NONE = 'NONE'
}

export enum Encoding{
    PDDL_CLASSIC = 'PDDL_CLASSIC',
    PDDL_NUMERIC = 'PDDL_NUMERIC',
    DOMAIN_DEPENDENT = 'DOMAIN_DEPENDENT',
    NONE = 'NONE'
}

export const ServiceTypeZ = nativeEnum(ServiceType);
export const EncodingZ = nativeEnum(Encoding);

export const ServiceBaseZ = object({
    name: string(),
    type : ServiceTypeZ,
    domainId: nullable(string()),
    url: string(),
    apiKey: string(),
    encoding: EncodingZ,
});

export type ServiceBase = zinfer<typeof ServiceBaseZ>;

export const ServiceZ = ServiceBaseZ.merge(
    object({
        _id: string(),
    })
)

export type Service = zinfer<typeof ServiceZ>;

const ServiceSchema = new Schema({
    name: { type: String, required: true},
    type: { type: String, required: true},
    domainId: { type: mongoose.Schema.Types.ObjectId, ref: 'domain-specification', required: false},
    url: { type: String, required: true},
    apiKey: { type: String, required: true},
    encoding: { type: String, required: true},
});

export const ServiceModel = mongoose.model<Service>('services', ServiceSchema);
