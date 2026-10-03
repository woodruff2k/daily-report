import type { ReportStatus, Role } from "@prisma/client";

export type { ReportStatus, Role };

export interface AuthTokenPayload {
  repId: string;
  name: string;
  role: Role;
}
