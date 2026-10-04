"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import SalesRepForm from "../../sales-rep-form";
import {
  getSalesRep,
  type SalesRepFormValues,
} from "@/lib/client/sales-rep-api";
import { useAdminRedirect } from "@/lib/client/use-admin-guard";

/** SCR-510 수정. 기존 값을 불러온 뒤 폼을 그린다. */
export default function EditSalesRepPage() {
  useAdminRedirect();
  const params = useParams<{ repId: string }>();
  const repId = Number(params.repId);
  const [values, setValues] = useState<SalesRepFormValues | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const rep = await getSalesRep(repId).catch(() => null);

      if (cancelled) {
        return;
      }

      if (rep === null) {
        setError("영업사원을 불러올 수 없습니다.");
        return;
      }

      setValues({
        empNo: rep.empNo,
        name: rep.name,
        email: rep.email,
        department: rep.department ?? "",
        position: rep.position ?? "",
        managerId: rep.managerId === null ? "" : String(rep.managerId),
        role: rep.role,
        status: rep.status,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [repId]);

  if (error !== null) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    );
  }

  if (values === null) {
    return <p className="text-sm text-muted-foreground">불러오는 중…</p>;
  }

  return <SalesRepForm repId={repId} initialValues={values} />;
}
