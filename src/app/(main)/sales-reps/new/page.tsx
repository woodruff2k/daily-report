"use client";

import SalesRepForm from "../sales-rep-form";
import { useAdminRedirect } from "@/lib/client/use-admin-guard";

/** SCR-510 신규 등록. */
export default function NewSalesRepPage() {
  useAdminRedirect();

  return <SalesRepForm />;
}
