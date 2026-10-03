import type { Role } from "@prisma/client";

export type { Role };

export interface AuthTokenPayload {
  repId: string;
  name: string;
  role: Role;
}
