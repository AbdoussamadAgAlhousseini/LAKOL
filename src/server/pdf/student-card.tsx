import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import QRCode from "qrcode";

export interface StudentCardData {
  school: { name: string; color: string; phone: string | null; logo: Buffer | null };
  yearName: string;
  student: {
    name: string;
    matricule: string;
    className: string | null;
    birthDate: string | null;
    photo: Buffer | null;
  };
  /** Contenu du QR code (identifiant vérifiable par l'école). */
  qr: string;
}

// Format carte bancaire (85,6 × 54 mm).
const W = 242.6;
const H = 153;

const s = StyleSheet.create({
  page: { width: W, height: H, fontFamily: "Helvetica", fontSize: 7, color: "#111827" },
  band: { height: 26, flexDirection: "row", alignItems: "center", paddingHorizontal: 8, gap: 6 },
  bandText: { color: "#ffffff", fontFamily: "Helvetica-Bold", fontSize: 8 },
  body: { flexDirection: "row", padding: 8, gap: 8 },
  photo: { width: 54, height: 66, objectFit: "cover", borderRadius: 3, backgroundColor: "#e5e7eb" },
  name: { fontFamily: "Helvetica-Bold", fontSize: 10, marginBottom: 3 },
  qr: { width: 56, height: 56 },
});

function Card({ d, qr }: { d: StudentCardData; qr: string }) {
  return (
    <Document title={`Carte scolaire — ${d.student.name}`}>
      <Page size={[W, H]} style={s.page}>
        <View style={[s.band, { backgroundColor: d.school.color }]}>
          {d.school.logo && <Image src={d.school.logo} style={{ width: 18, height: 18 }} />}
          <Text style={s.bandText}>{d.school.name}</Text>
        </View>
        <View style={s.body}>
          {d.student.photo ? <Image src={d.student.photo} style={s.photo} /> : <View style={s.photo} />}
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 6, color: "#6b7280" }}>CARTE SCOLAIRE {d.yearName}</Text>
            <Text style={s.name}>{d.student.name}</Text>
            <Text>Matricule : {d.student.matricule}</Text>
            {d.student.className && <Text>Classe : {d.student.className}</Text>}
            {d.student.birthDate && <Text>Né(e) le : {d.student.birthDate}</Text>}
            {d.school.phone && <Text style={{ marginTop: 4, color: "#6b7280" }}>École : {d.school.phone}</Text>}
          </View>
          <Image src={qr} style={s.qr} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderStudentCard(data: StudentCardData): Promise<Buffer> {
  const qr = await QRCode.toDataURL(data.qr, { margin: 0, width: 240 });
  return renderToBuffer(<Card d={data} qr={qr} />);
}
