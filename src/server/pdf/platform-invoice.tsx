import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { formatMoney } from "@/lib/money";
import { amountInWords } from "@/lib/number-words";

export interface PlatformInvoicePdfData {
  number: string;
  issuedAt: string;
  dueDate: string;
  status: "ISSUED" | "PAID" | "VOID";
  paidAt: string | null;
  school: { name: string; city: string | null; address: string | null; phone: string | null; email: string | null };
  planName: string;
  period: string;
  studentCount: number;
  pricePerStudent: number;
  amount: number;
  currency: string;
  notes: string | null;
}

const BRAND = "#0F766E";

const s = StyleSheet.create({
  page: { padding: 36, fontSize: 10, fontFamily: "Helvetica", color: "#1f2937" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderBottomWidth: 2,
    borderBottomColor: BRAND,
    paddingBottom: 10,
    marginBottom: 18,
  },
  brand: { fontSize: 22, fontFamily: "Helvetica-Bold", color: BRAND },
  small: { fontSize: 8.5, color: "#4b5563" },
  title: { fontSize: 16, fontFamily: "Helvetica-Bold", textAlign: "right" },
  bold: { fontFamily: "Helvetica-Bold" },
  box: { borderWidth: 1, borderColor: "#d1d5db", borderRadius: 4, padding: 10, marginBottom: 14 },
  th: { flexDirection: "row", backgroundColor: "#f3f4f6", paddingVertical: 5, paddingHorizontal: 6 },
  tr: {
    flexDirection: "row",
    paddingVertical: 6,
    paddingHorizontal: 6,
    borderBottomWidth: 0.5,
    borderColor: "#e5e7eb",
  },
  c1: { flex: 3 },
  c2: { flex: 1, textAlign: "right" },
  total: { flexDirection: "row", justifyContent: "flex-end", marginTop: 8, gap: 20 },
  stamp: {
    position: "absolute",
    top: 300,
    left: 150,
    fontSize: 60,
    fontFamily: "Helvetica-Bold",
    opacity: 0.15,
    transform: "rotate(-25deg)",
  },
  footer: { position: "absolute", bottom: 28, left: 36, right: 36, fontSize: 8, color: "#6b7280", textAlign: "center" },
});

function InvoiceDoc({ d }: { d: PlatformInvoicePdfData }) {
  const money = (v: number) => formatMoney(v, d.currency).replace(/ | /g, " ");
  return (
    <Document title={`Facture ${d.number}`} author="LAKOL">
      <Page size="A4" style={s.page}>
        {d.status !== "ISSUED" && (
          <Text style={[s.stamp, { color: d.status === "PAID" ? "#16a34a" : "#dc2626" }]}>
            {d.status === "PAID" ? "PAYÉE" : "ANNULÉE"}
          </Text>
        )}
        <View style={s.header}>
          <View>
            <Text style={s.brand}>LAKOL</Text>
            <Text style={s.small}>Plateforme de gestion scolaire</Text>
          </View>
          <View>
            <Text style={s.title}>Facture {d.number}</Text>
            <Text style={[s.small, { textAlign: "right" }]}>Émise le {d.issuedAt}</Text>
            <Text style={[s.small, { textAlign: "right" }]}>À régler avant le {d.dueDate}</Text>
          </View>
        </View>

        <View style={s.box}>
          <Text style={s.small}>Facturé à</Text>
          <Text style={s.bold}>{d.school.name}</Text>
          {d.school.address && <Text>{d.school.address}</Text>}
          {d.school.city && <Text>{d.school.city}</Text>}
          {(d.school.phone || d.school.email) && (
            <Text style={s.small}>{[d.school.phone, d.school.email].filter(Boolean).join(" · ")}</Text>
          )}
        </View>

        <View style={s.th}>
          <Text style={[s.c1, s.bold]}>Désignation</Text>
          <Text style={[s.c2, s.bold]}>Élèves</Text>
          <Text style={[s.c2, s.bold]}>Prix / élève</Text>
          <Text style={[s.c2, s.bold]}>Montant</Text>
        </View>
        <View style={s.tr}>
          <Text style={s.c1}>
            Abonnement LAKOL — formule {d.planName}
            {"\n"}
            <Text style={s.small}>Période : {d.period}</Text>
          </Text>
          <Text style={s.c2}>{d.studentCount}</Text>
          <Text style={s.c2}>{money(d.pricePerStudent)}</Text>
          <Text style={s.c2}>{money(d.amount)}</Text>
        </View>
        <View style={s.total}>
          <Text style={s.bold}>Total</Text>
          <Text style={[s.bold, { fontSize: 12 }]}>{money(d.amount)}</Text>
        </View>
        <Text style={[s.small, { marginTop: 6, textAlign: "right" }]}>
          Arrêtée à la somme de {amountInWords(d.amount, d.currency)}.
        </Text>

        {d.paidAt && <Text style={{ marginTop: 18, color: "#16a34a" }}>Réglée le {d.paidAt}. Merci !</Text>}
        {d.notes && <Text style={[s.small, { marginTop: 12 }]}>{d.notes}</Text>}
        <Text style={{ marginTop: 18 }}>
          Règlement par virement, chèque ou mobile money. Indiquez le numéro de facture en référence.
        </Text>
        <Text style={s.footer}>LAKOL — facture générée automatiquement. Données conservées même en cas de retard.</Text>
      </Page>
    </Document>
  );
}

export function renderPlatformInvoice(d: PlatformInvoicePdfData) {
  return renderToBuffer(<InvoiceDoc d={d} />);
}
