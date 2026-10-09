/** Couleur du badge de statut d'abonnement. */
export const STATUS_VARIANT = {
  TRIAL: "secondary",
  ACTIVE: "success",
  PAST_DUE: "warning",
  SUSPENDED: "destructive",
  CANCELLED: "outline",
} as const;

export const INVOICE_VARIANT = { ISSUED: "warning", PAID: "success", VOID: "outline" } as const;
