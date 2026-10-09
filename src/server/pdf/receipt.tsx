import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { formatMoney } from "@/lib/money";
import { amountInWords } from "@/lib/number-words";

export interface ReceiptPdfData {
  school: {
    name: string;
    address: string | null;
    phone: string | null;
    color: string;
    currency: string;
    logo: Buffer | null;
  };
  number: string;
  date: string;
  cancelled: boolean;
  student: { name: string; matricule: string; className: string | null };
  payer: string | null;
  method: string;
  reference: string | null;
  amount: number;
  lines: { label: string; amount: number }[];
  balanceAfter: number;
  cashier: string;
}

const METHODS: Record<string, string> = {
  CASH: "Espèces",
  CHEQUE: "Chèque",
  TRANSFER: "Virement",
  MOBILE_MONEY: "Mobile money",
};

const s = StyleSheet.create({
  page: { padding: 32, fontSize: 10, fontFamily: "Helvetica", color: "#1f2937" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderBottomWidth: 2,
    paddingBottom: 8,
    marginBottom: 14,
  },
  name: { fontSize: 14, fontFamily: "Helvetica-Bold" },
  small: { fontSize: 8.5, color: "#4b5563" },
  title: { fontSize: 16, fontFamily: "Helvetica-Bold" },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: "#e5e7eb",
  },
  box: { borderWidth: 1, borderColor: "#d1d5db", borderRadius: 4, padding: 10, marginVertical: 10 },
  bold: { fontFamily: "Helvetica-Bold" },
  stamp: {
    position: "absolute",
    top: 260,
    left: 120,
    fontSize: 64,
    color: "#dc2626",
    opacity: 0.25,
    transform: "rotate(-25deg)",
  },
});

function Receipt({ d }: { d: ReceiptPdfData }) {
  const money = (v: number) => formatMoney(v, d.school.currency).replace(/ | /g, " ");
  return (
    <Document title={`Reçu ${d.number}`} author={d.school.name} language="fr">
      <Page size="A5" orientation="landscape" style={s.page}>
        {d.cancelled && <Text style={s.stamp}>ANNULÉ</Text>}
        <View style={[s.header, { borderBottomColor: d.school.color }]}>
          {d.school.logo && <Image src={d.school.logo} style={{ width: 40, height: 40, objectFit: "contain" }} />}
          <View style={{ flex: 1 }}>
            <Text style={s.name}>{d.school.name}</Text>
            <Text style={s.small}>{[d.school.address, d.school.phone].filter(Boolean).join(" · ")}</Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={[s.title, { color: d.school.color }]}>REÇU N° {d.number}</Text>
            <Text style={s.small}>{d.date}</Text>
          </View>
        </View>

        <Text>
          Reçu de : <Text style={s.bold}>{d.payer ?? "—"}</Text>
        </Text>
        <Text>
          Pour l&apos;élève : <Text style={s.bold}>{d.student.name}</Text> — matricule {d.student.matricule}
          {d.student.className ? ` — ${d.student.className}` : ""}
        </Text>

        <View style={s.box}>
          {d.lines.map((l, i) => (
            <View key={i} style={s.row}>
              <Text>{l.label}</Text>
              <Text>{money(l.amount)}</Text>
            </View>
          ))}
          <View style={[s.row, { borderBottomWidth: 0, marginTop: 4 }]}>
            <Text style={s.bold}>Montant reçu</Text>
            <Text style={[s.bold, { fontSize: 13 }]}>{money(d.amount)}</Text>
          </View>
        </View>

        <Text>
          Arrêté le présent reçu à la somme de :{" "}
          <Text style={s.bold}>{amountInWords(d.amount, d.school.currency)}</Text>.
        </Text>
        <Text style={{ marginTop: 4 }}>
          Mode de paiement : {METHODS[d.method] ?? d.method}
          {d.reference ? ` — référence ${d.reference}` : ""}
        </Text>
        <Text style={{ marginTop: 4 }}>Reste à payer après ce versement : {money(d.balanceAfter)}</Text>

        <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 24 }}>
          <Text style={s.small}>Édité avec LAKOL — reçu à conserver</Text>
          <View
            style={{ alignItems: "center", width: 180, borderTopWidth: 0.5, borderTopColor: "#9ca3af", paddingTop: 3 }}
          >
            <Text style={s.small}>Le caissier : {d.cashier}</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}

export function renderReceipt(data: ReceiptPdfData): Promise<Buffer> {
  return renderToBuffer(<Receipt d={data} />);
}
