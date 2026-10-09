"use client";

import { createContext, isValidElement, useContext, useRef, useState, useTransition, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Alert } from "@/components/ui/alert";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { ActionResult } from "@/server/action";

type Action = (slug: string, form: FormData) => Promise<ActionResult<unknown>>;

const FormContext = createContext<{ fields: Record<string, string>; pending: boolean }>({ fields: {}, pending: false });

/**
 * Formulaire relié à une action d'école : envoi, erreurs par champ et
 * message global, puis redirection ou rafraîchissement.
 * `redirectTo` peut contenir « {id} », remplacé par l'id renvoyé.
 */
export function ActionForm({
  action,
  school,
  children,
  redirectTo,
  successMessage,
  resetOnSuccess,
  confirm,
  className,
}: {
  action: Action;
  school: string;
  children: ReactNode;
  redirectTo?: string;
  successMessage?: string;
  resetOnSuccess?: boolean;
  confirm?: string;
  className?: string;
}) {
  const t = useTranslations("form");
  const te = useTranslations("errors");
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult<unknown> | null>(null);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (confirm && !window.confirm(confirm)) return;
    const data = new FormData(event.currentTarget);
    start(async () => {
      const res = await action(school, data);
      setResult(res);
      if (!res.ok) return;
      if (resetOnSuccess) formRef.current?.reset();
      if (redirectTo) {
        const id = (res.data as { id?: string } | null)?.id ?? "";
        router.push(redirectTo.replace("{id}", id));
      } else router.refresh();
    });
  }

  const error = result && !result.ok ? result : null;
  const message = error
    ? error.error === "domain" && error.code
      ? te.has(error.code)
        ? te(error.code)
        : te("generic")
      : te(error.error)
    : null;

  return (
    <FormContext.Provider value={{ fields: error?.fields ?? {}, pending }}>
      <form ref={formRef} onSubmit={onSubmit} className={cn("flex flex-col gap-4", className)} noValidate>
        {message && <Alert variant="destructive">{message}</Alert>}
        {result?.ok && successMessage && <Alert variant="success">{successMessage}</Alert>}
        {children}
      </form>
      {/* Lecteurs d'écran : annonce l'état de l'envoi */}
      <span className="sr-only" aria-live="polite">
        {pending ? t("sending") : ""}
      </span>
    </FormContext.Provider>
  );
}

export function Field({
  name,
  label,
  hint,
  children,
  className,
}: {
  name: string;
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  const { fields } = useContext(FormContext);
  const t = useTranslations("form");
  const te = useTranslations("errors");
  const issue = fields[name];
  // L'étiquette pointe vers le champ contenu (son id), sinon vers le nom.
  const childId = isValidElement<{ id?: string }>(children) ? children.props.id : undefined;
  return (
    <div className={cn("flex flex-col gap-2", className)} data-invalid={issue ? true : undefined}>
      <Label htmlFor={childId ?? name}>{label}</Label>
      {children}
      {hint && !issue && <p className="text-muted-foreground text-xs">{hint}</p>}
      {issue && (
        <p className="text-destructive text-sm" role="alert">
          {issue === "required" || issue === "invalid" ? t(issue) : te.has(issue) ? te(issue) : t("invalid")}
        </p>
      )}
    </div>
  );
}

export function SubmitButton({ children, ...props }: ButtonProps) {
  const { pending } = useContext(FormContext);
  return (
    <Button type="submit" disabled={pending || props.disabled} {...props}>
      {children}
    </Button>
  );
}

/** Bouton-formulaire pour une action simple (activer, supprimer…). */
export function ActionButton({
  action,
  school,
  fields,
  confirm,
  children,
  variant = "outline",
  size = "sm",
  redirectTo,
}: {
  action: Action;
  school: string;
  fields: Record<string, string>;
  confirm?: string;
  children: ReactNode;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  redirectTo?: string;
}) {
  return (
    <ActionForm
      action={action}
      school={school}
      confirm={confirm}
      redirectTo={redirectTo}
      className="inline-flex items-start gap-0 self-start"
    >
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <SubmitButton variant={variant} size={size}>
        {children}
      </SubmitButton>
    </ActionForm>
  );
}
