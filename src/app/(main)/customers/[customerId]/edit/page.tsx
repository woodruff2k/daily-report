"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import CustomerForm from "../../customer-form";
import {
  getCustomer,
  type CustomerFormValues,
} from "@/lib/client/customer-api";
import { useCustomerErrors } from "../../use-customer-errors";

/** SCR-410 수정. 기존 값을 불러온 뒤 폼을 그린다. */
export default function EditCustomerPage() {
  const report = useCustomerErrors();
  const params = useParams<{ customerId: string }>();
  const customerId = Number(params.customerId);
  const [values, setValues] = useState<CustomerFormValues | null>(null);
  const [repName, setRepName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const customer = await getCustomer(customerId);
        if (cancelled) {
          return;
        }
        setRepName(customer.assignedRepName);
        setValues({
          customerName: customer.customerName,
          companyName: customer.companyName ?? "",
          phone: customer.phone ?? "",
          email: customer.email ?? "",
          address: customer.address ?? "",
          grade: customer.grade ?? "",
          assignedRepId:
            customer.assignedRepId === null
              ? ""
              : String(customer.assignedRepId),
          status: customer.status,
        });
      } catch (caught) {
        if (!cancelled) {
          setError(report(caught, "고객을 불러올 수 없습니다."));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [customerId, report]);

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

  return (
    <CustomerForm
      customerId={customerId}
      initialValues={values}
      initialAssignedRepName={repName}
    />
  );
}
