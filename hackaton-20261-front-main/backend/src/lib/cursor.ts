import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { AppError } from "./errors.js";

interface CursorPayload {
  createdAt: string;
  id: string;
  filtersHash: string;
}

export function filtersHash(filters: Record<string, string | undefined>): string {
  const normalized = Object.entries(filters)
    .filter((entry): entry is [string, string] => entry[1] !== undefined && entry[1] !== "")
    .sort(([left], [right]) => left.localeCompare(right));
  return createHash("sha256").update(JSON.stringify(normalized)).digest("base64url");
}

export function encodeCursor(payload: CursorPayload, secret: string): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

export function decodeCursor(cursor: string, expectedFiltersHash: string, secret: string): CursorPayload {
  try {
    const [encoded, signature] = cursor.split(".");
    if (!encoded || !signature) throw new Error("Malformed cursor");
    const expected = createHmac("sha256", secret).update(encoded).digest();
    const received = Buffer.from(signature, "base64url");
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
      throw new Error("Invalid cursor signature");
    }
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as CursorPayload;
    if (
      typeof payload.createdAt !== "string" ||
      typeof payload.id !== "string" ||
      payload.filtersHash !== expectedFiltersHash
    ) {
      throw new Error("Cursor does not match filters");
    }
    return payload;
  } catch {
    throw new AppError(400, "VALIDATION_ERROR", "El cursor es invalido o pertenece a otros filtros", {
      field: "cursor",
    });
  }
}
