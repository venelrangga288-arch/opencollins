import { randomUUID } from "node:crypto";

export function newRequestId(): string {
  return `req_${randomUUID()}`;
}
