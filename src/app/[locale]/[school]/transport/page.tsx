import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Bus, MapPin, Trash2, X } from "lucide-react";
import { loadGuardedPage } from "@/server/page-context";
import { canAll } from "@/server/rbac/policies";
import { familyTransport, listRoutes } from "@/server/services/modules/transport";
import { formatTime } from "@/lib/time";
import { ActionButton, ActionForm, Field, SubmitButton } from "@/components/forms/action-form";
import { StudentSelect } from "@/components/forms/student-select";
import { Forbidden } from "@/components/layout/forbidden";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  addStopAction,
  assignAction,
  deleteRouteAction,
  deleteStopAction,
  saveRouteAction,
  unassignAction,
} from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("transport"))("title") };
}

const hm = (m: number | null) => (m === null ? "—" : formatTime(m));

export default async function TransportPage({ params }: { params: Promise<{ locale: string; school: string }> }) {
  const { locale, school } = await params;
  const ctx = await loadGuardedPage(
    school,
    locale,
    (c) => canAll(c.scope, "transport.manage") || c.scope.permissions.has("transport.read:own"),
  );
  if (!ctx) return <Forbidden />;
  const t = await getTranslations("transport");

  if (!canAll(ctx.scope, "transport.manage")) {
    const children = await familyTransport(ctx);
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={t("title")} description={t("familyHint")} />
        <div className="grid gap-3 sm:grid-cols-2" data-testid="family-transport">
          {children.map((c) => (
            <Card key={c.id}>
              <CardHeader>
                <CardTitle className="text-base">{c.name}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm">
                {c.assignment ? (
                  <div className="flex flex-col gap-1">
                    <p className="flex items-center gap-2 font-medium">
                      <Bus className="text-primary size-5" aria-hidden /> {c.assignment.route.name}
                      {c.assignment.route.vehicle && (
                        <span className="text-muted-foreground font-normal">· {c.assignment.route.vehicle}</span>
                      )}
                    </p>
                    {c.assignment.stop && (
                      <p className="flex items-center gap-2">
                        <MapPin className="size-4" aria-hidden /> {c.assignment.stop.name} —{" "}
                        {t("times", {
                          pickup: hm(c.assignment.stop.pickupMin),
                          dropoff: hm(c.assignment.stop.dropoffMin),
                        })}
                      </p>
                    )}
                    {c.assignment.route.driver && (
                      <p className="text-muted-foreground">
                        {t("driver")} : {c.assignment.route.driver.firstName} {c.assignment.route.driver.lastName}
                        {c.assignment.route.driver.phone && ` · ${c.assignment.route.driver.phone}`}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-muted-foreground">{t("noTransport")}</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  const [routes, staff] = await Promise.all([
    listRoutes(ctx),
    ctx.db.staff.findMany({ where: { isActive: true, deletedAt: null }, orderBy: { lastName: "asc" } }),
  ]);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} description={t("managerHint")} />
      <Card>
        <CardHeader>
          <CardTitle>{t("newRoute")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ActionForm action={saveRouteAction} school={school} resetOnSuccess className="grid gap-3 sm:grid-cols-4">
            <Field name="name" label={t("routeName")}>
              <Input id="name" name="name" required maxLength={80} placeholder={t("routeNamePlaceholder")} />
            </Field>
            <Field name="vehicle" label={t("vehicle")}>
              <Input id="vehicle" name="vehicle" maxLength={80} />
            </Field>
            <Field name="capacity" label={t("capacity")}>
              <Input id="capacity" name="capacity" type="number" min={1} max={200} />
            </Field>
            <Field name="driverStaffId" label={t("driver")}>
              <Select id="driverStaffId" name="driverStaffId" defaultValue="">
                <option value="">—</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.lastName} {s.firstName}
                  </option>
                ))}
              </Select>
            </Field>
            <SubmitButton className="self-start">{t("createRoute")}</SubmitButton>
          </ActionForm>
        </CardContent>
      </Card>

      {routes.map((r) => (
        <Card key={r.id} data-testid="route">
          <CardHeader className="flex-row items-start justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Bus className="text-primary size-5" aria-hidden /> {r.name}
              </CardTitle>
              <p className="text-muted-foreground text-sm">
                {[r.vehicle, r.driver && `${r.driver.firstName} ${r.driver.lastName}`].filter(Boolean).join(" · ")}
                {" · "}
                {t("load", { count: r.assignments.length, capacity: r.capacity ?? "∞" })}
              </p>
            </div>
            <ActionButton
              action={deleteRouteAction}
              school={school}
              fields={{ id: r.id }}
              variant="ghost"
              confirm={t("confirmDeleteRoute")}
            >
              <Trash2 aria-hidden />
              <span className="sr-only">{t("deleteRoute")}</span>
            </ActionButton>
          </CardHeader>
          <CardContent className="grid gap-6 lg:grid-cols-2">
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">{t("stops")}</h3>
              <ol className="flex flex-col gap-1 text-sm">
                {r.stops.map((s) => (
                  <li key={s.id} className="flex items-center gap-2">
                    <span className="bg-primary/10 text-primary flex size-6 items-center justify-center rounded-full text-xs font-bold">
                      {s.order}
                    </span>
                    <span className="flex-1">{s.name}</span>
                    <span className="text-muted-foreground text-xs tabular-nums">
                      {hm(s.pickupMin)} / {hm(s.dropoffMin)}
                    </span>
                    <ActionButton action={deleteStopAction} school={school} fields={{ id: s.id }} variant="ghost">
                      <X aria-hidden />
                      <span className="sr-only">{t("deleteStop")}</span>
                    </ActionButton>
                  </li>
                ))}
              </ol>
              <ActionForm
                action={addStopAction}
                school={school}
                resetOnSuccess
                className="grid grid-cols-2 gap-2 sm:grid-cols-4"
              >
                <input type="hidden" name="routeId" value={r.id} />
                <Field name="name" label={t("stopName")} className="col-span-2">
                  <Input id={`stop-${r.id}`} name="name" required maxLength={80} />
                </Field>
                <Field name="pickup" label={t("pickup")}>
                  <Input id={`pickup-${r.id}`} name="pickup" type="time" />
                </Field>
                <Field name="dropoff" label={t("dropoff")}>
                  <Input id={`dropoff-${r.id}`} name="dropoff" type="time" />
                </Field>
                <SubmitButton size="sm" variant="outline" className="col-span-2 self-start sm:col-span-4">
                  {t("addStop")}
                </SubmitButton>
              </ActionForm>
            </section>
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">{t("students")}</h3>
              <ul className="flex flex-col gap-1 text-sm">
                {r.assignments.map((a) => (
                  <li key={a.id} className="flex items-center gap-2">
                    <span className="flex-1">
                      {a.student.lastName} {a.student.firstName}
                      {a.stop && <span className="text-muted-foreground"> · {a.stop.name}</span>}
                    </span>
                    <ActionButton action={unassignAction} school={school} fields={{ id: a.id }} variant="ghost">
                      <X aria-hidden />
                      <span className="sr-only">{t("unassign")}</span>
                    </ActionButton>
                  </li>
                ))}
              </ul>
              <ActionForm action={assignAction} school={school} resetOnSuccess className="grid gap-2 sm:grid-cols-2">
                <input type="hidden" name="routeId" value={r.id} />
                <Field name="studentId" label={t("student")}>
                  <StudentSelect ctx={ctx} id={`student-${r.id}`} />
                </Field>
                <Field name="stopId" label={t("stop")}>
                  <Select id={`stopsel-${r.id}`} name="stopId" defaultValue="">
                    <option value="">—</option>
                    {r.stops.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <SubmitButton size="sm" className="self-start">
                  {t("assign")}
                </SubmitButton>
              </ActionForm>
            </section>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
