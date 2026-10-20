import { Type, type Static } from "@sinclair/typebox";

export const Species = Type.Union(
  [Type.Literal("BLOBITO"), Type.Literal("CHISPA"), Type.Literal("GRUNON"), Type.Literal("DORMILON"), Type.Literal("GLITCHY")],
  { $id: "Species" },
);
export const VitalState = Type.Union(
  [Type.Literal("ESTABLE"), Type.Literal("HAMBRIENTO"), Type.Literal("AGITADO"), Type.Literal("MUTANDO"), Type.Literal("CRITICO")],
  { $id: "VitalState" },
);
export const SignalType = Type.Union(
  [
    Type.Literal("HAMBRE"),
    Type.Literal("ABANDONO"),
    Type.Literal("MUTACION"),
    Type.Literal("FUGA"),
    Type.Literal("CONFLICTO"),
    Type.Literal("REPRODUCCION_MASIVA"),
    Type.Literal("SENAL_CORRUPTA"),
  ],
  { $id: "SignalType" },
);
export const Severity = Type.Union(
  [Type.Literal("LEVE"), Type.Literal("MODERADO"), Type.Literal("GRAVE"), Type.Literal("CRITICO")],
  { $id: "Severity" },
);
export const SignalStatus = Type.Union(
  [Type.Literal("RECIBIDA"), Type.Literal("PROCESANDO"), Type.Literal("ATENDIDA")],
  { $id: "SignalStatus" },
);
export const MutableSignalStatus = Type.Union([Type.Literal("PROCESANDO"), Type.Literal("ATENDIDA")]);
export const Climate = Type.Union(
  [Type.Literal("PIXEL_FOREST"), Type.Literal("NEON_CAVE"), Type.Literal("CLOUD_AQUARIUM"), Type.Literal("RETRO_ARCADE")],
  { $id: "Climate" },
);

export const ErrorResponse = Type.Object(
  {
    error: Type.String(),
    message: Type.String(),
    timestamp: Type.String({ format: "date-time" }),
    path: Type.String(),
    details: Type.Record(Type.String(), Type.Unknown()),
  },
  { $id: "ErrorResponse", additionalProperties: false },
);

export const User = Type.Object(
  {
    id: Type.String(),
    displayName: Type.String(),
    email: Type.String({ format: "email" }),
    teamCode: Type.String(),
    role: Type.Literal("OPERATOR"),
  },
  { $id: "User", additionalProperties: false },
);

export const SectorSummary = Type.Object(
  {
    id: Type.String(),
    sectorCode: Type.String(),
    name: Type.String(),
    climate: Climate,
    capacity: Type.Integer(),
    currentLoad: Type.Integer({ minimum: 0, description: "Cantidad real de Tropeles asignados al sector" }),
    stabilityLevel: Type.Integer(),
  },
  { $id: "SectorSummary", additionalProperties: false },
);

export const Tropel = Type.Object(
  {
    id: Type.String(),
    name: Type.String(),
    species: Species,
    vitalState: VitalState,
    energyLevel: Type.Integer(),
    chaosIndex: Type.Integer(),
    mutationStage: Type.Integer(),
    guardianName: Type.String(),
    sector: Type.Pick(SectorSummary, ["id", "name", "sectorCode"]),
    createdAt: Type.String({ format: "date-time" }),
    updatedAt: Type.String({ format: "date-time" }),
  },
  { $id: "Tropel", additionalProperties: false },
);

export const Signal = Type.Object(
  {
    id: Type.String(),
    signalType: SignalType,
    severity: Severity,
    status: SignalStatus,
    rawContent: Type.String(),
    tropel: Type.Object({ id: Type.String(), name: Type.String(), species: Species }),
    createdAt: Type.String({ format: "date-time" }),
    updatedAt: Type.String({ format: "date-time" }),
  },
  { $id: "Signal", additionalProperties: false },
);

export type TropelDto = Static<typeof Tropel>;
export type SignalDto = Static<typeof Signal>;
