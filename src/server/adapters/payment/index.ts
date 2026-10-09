import type { PaymentMethod } from "@prisma/client";

/**
 * Fournisseur de paiement. Aujourd'hui, les parents paient à l'école : le
 * caissier enregistre le paiement (provider « manual »). Le mobile money
 * (Orange Money, Moov Money, Wave) se branchera ici sans toucher au reste :
 * `initiate` demandera le paiement au téléphone du parent, et un webhook
 * appellera `recordPayment` (services/finance/payments.ts) une fois confirmé.
 */
export interface PaymentProvider {
  readonly name: string;
  readonly methods: PaymentMethod[];
  /** Paiement en ligne : demande au fournisseur, renvoie sa référence. */
  initiate?(input: {
    amount: number;
    currency: string;
    phone: string;
    reference: string;
  }): Promise<{ providerRef: string }>;
}

export const manualProvider: PaymentProvider = {
  name: "manual",
  methods: ["CASH", "CHEQUE", "TRANSFER"],
};

export function getPaymentProvider(name = "manual"): PaymentProvider {
  if (name !== "manual") throw new Error(`Fournisseur de paiement non disponible : ${name}`);
  return manualProvider;
}
