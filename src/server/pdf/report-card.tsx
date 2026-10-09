import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { formatScore } from "@/lib/grades";

export interface ReportCardPdfData {
  school: {
    name: string;
    header: string | null;
    address: string | null;
    phone: string | null;
    color: string;
    logo: Buffer | null;
  };
  yearName: string;
  termName: string;
  className: string;
  classSize: number;
  scale: number;
  student: { name: string; matricule: string; gender: string; birthDate: string | null };
  subjects: {
    name: string;
    teacher: string | null;
    coefficient: number;
    average: number | null;
    rank: number | null;
    classAverage: number | null;
    highest: number | null;
    lowest: number | null;
    appraisal: string | null;
  }[];
  average: number | null;
  rank: number | null;
  classAverage: number | null;
  highest: number | null;
  lowest: number | null;
  absences: { absent: number; excused: number; late: number };
  decision: string | null;
  distinction: string | null;
  generalComment: string | null;
  issuedAt: string;
}

const s = StyleSheet.create({
  page: { padding: 28, fontSize: 9, fontFamily: "Helvetica", color: "#1f2937" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderBottomWidth: 2,
    paddingBottom: 8,
    marginBottom: 10,
  },
  logo: { width: 48, height: 48, objectFit: "contain" },
  schoolName: { fontSize: 14, fontFamily: "Helvetica-Bold" },
  small: { fontSize: 8, color: "#4b5563" },
  title: { fontSize: 13, fontFamily: "Helvetica-Bold", textAlign: "center", marginVertical: 6 },
  box: { borderWidth: 1, borderColor: "#d1d5db", borderRadius: 3, padding: 6, marginBottom: 8 },
  row: { flexDirection: "row" },
  th: { fontFamily: "Helvetica-Bold", fontSize: 8, color: "#ffffff", padding: 3 },
  td: { padding: 3, fontSize: 8.5, borderBottomWidth: 0.5, borderBottomColor: "#e5e7eb" },
  bold: { fontFamily: "Helvetica-Bold" },
  big: { fontSize: 16, fontFamily: "Helvetica-Bold" },
  sign: {
    flex: 1,
    height: 50,
    borderTopWidth: 0.5,
    borderTopColor: "#9ca3af",
    marginHorizontal: 8,
    paddingTop: 3,
    fontSize: 8,
    textAlign: "center",
  },
});

const COLS = [
  { key: "name", label: "Matière", width: "24%" },
  { key: "coefficient", label: "Coef.", width: "6%" },
  { key: "average", label: "Moy.", width: "8%" },
  { key: "points", label: "Points", width: "8%" },
  { key: "rank", label: "Rang", width: "6%" },
  { key: "class", label: "Moy. cl.", width: "8%" },
  { key: "minmax", label: "Min / Max", width: "12%" },
  { key: "appraisal", label: "Appréciation", width: "28%" },
] as const;

function ReportCardDocument({ d }: { d: ReportCardPdfData }) {
  const f = (v: number | null) => formatScore(v, "fr");
  const totalCoef = d.subjects.reduce((t, x) => t + (x.average !== null ? x.coefficient : 0), 0);
  return (
    <Document title={`Bulletin ${d.termName} — ${d.student.name}`} author={d.school.name} language="fr">
      <Page size="A4" style={s.page}>
        <View style={[s.header, { borderBottomColor: d.school.color }]}>
          {d.school.logo && <Image src={d.school.logo} style={s.logo} />}
          <View style={{ flex: 1 }}>
            {d.school.header ? (
              d.school.header.split("\n").map((line, i) => (
                <Text key={i} style={i === d.school.header!.split("\n").length - 1 ? s.schoolName : s.small}>
                  {line}
                </Text>
              ))
            ) : (
              <Text style={s.schoolName}>{d.school.name}</Text>
            )}
            <Text style={s.small}>{[d.school.address, d.school.phone].filter(Boolean).join(" · ")}</Text>
          </View>
          <View>
            <Text style={s.small}>Année scolaire {d.yearName}</Text>
          </View>
        </View>

        <Text style={[s.title, { color: d.school.color }]}>BULLETIN DE NOTES — {d.termName.toUpperCase()}</Text>

        <View style={[s.box, s.row]}>
          <View style={{ flex: 2 }}>
            <Text>
              Élève : <Text style={s.bold}>{d.student.name}</Text>
            </Text>
            <Text>Matricule : {d.student.matricule}</Text>
            <Text>
              Sexe : {d.student.gender === "FEMALE" ? "F" : "M"}
              {d.student.birthDate ? `   Né(e) le : ${d.student.birthDate}` : ""}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text>
              Classe : <Text style={s.bold}>{d.className}</Text>
            </Text>
            <Text>Effectif : {d.classSize}</Text>
          </View>
        </View>

        <View style={[s.row, { backgroundColor: d.school.color }]}>
          {COLS.map((c) => (
            <Text key={c.key} style={[s.th, { width: c.width }]}>
              {c.label}
            </Text>
          ))}
        </View>
        {d.subjects.map((x, i) => (
          <View key={i} style={[s.row, { backgroundColor: i % 2 ? "#f9fafb" : "#ffffff" }]} wrap={false}>
            <View style={[s.td, { width: COLS[0].width }]}>
              <Text style={s.bold}>{x.name}</Text>
              {x.teacher && <Text style={s.small}>{x.teacher}</Text>}
            </View>
            <Text style={[s.td, { width: COLS[1].width }]}>{x.coefficient}</Text>
            <Text style={[s.td, s.bold, { width: COLS[2].width }]}>{f(x.average)}</Text>
            <Text style={[s.td, { width: COLS[3].width }]}>
              {x.average === null ? "—" : f(x.average * x.coefficient)}
            </Text>
            <Text style={[s.td, { width: COLS[4].width }]}>{x.rank ?? "—"}</Text>
            <Text style={[s.td, { width: COLS[5].width }]}>{f(x.classAverage)}</Text>
            <Text style={[s.td, { width: COLS[6].width }]}>
              {f(x.lowest)} / {f(x.highest)}
            </Text>
            <Text style={[s.td, { width: COLS[7].width }]}>{x.appraisal ?? ""}</Text>
          </View>
        ))}

        <View style={[s.row, { marginTop: 10, gap: 8 }]} wrap={false}>
          <View style={[s.box, { flex: 1, alignItems: "center" }]}>
            <Text style={s.small}>Moyenne générale</Text>
            <Text style={[s.big, { color: d.school.color }]}>
              {f(d.average)} / {d.scale}
            </Text>
            <Text style={s.small}>Total des coefficients : {totalCoef}</Text>
          </View>
          <View style={[s.box, { flex: 1, alignItems: "center" }]}>
            <Text style={s.small}>Rang</Text>
            <Text style={s.big}>{d.rank ? `${d.rank}${d.rank === 1 ? "er" : "e"} / ${d.classSize}` : "—"}</Text>
          </View>
          <View style={[s.box, { flex: 1.4 }]}>
            <Text>Moyenne de la classe : {f(d.classAverage)}</Text>
            <Text>Plus forte moyenne : {f(d.highest)}</Text>
            <Text>Plus faible moyenne : {f(d.lowest)}</Text>
          </View>
          <View style={[s.box, { flex: 1.2 }]}>
            <Text style={s.bold}>Assiduité</Text>
            <Text>
              Absences : {d.absences.absent + d.absences.excused} (dont {d.absences.excused} justifiées)
            </Text>
            <Text>Retards : {d.absences.late}</Text>
          </View>
        </View>

        <View style={s.box} wrap={false}>
          <Text style={s.bold}>Appréciation du professeur principal</Text>
          <Text style={{ marginTop: 3, minHeight: 24 }}>{d.generalComment ?? ""}</Text>
          {(d.distinction || d.decision) && (
            <Text style={{ marginTop: 4 }}>
              Conseil de classe : <Text style={s.bold}>{[d.distinction, d.decision].filter(Boolean).join(" — ")}</Text>
            </Text>
          )}
        </View>

        <View style={[s.row, { marginTop: 18 }]} wrap={false}>
          <Text style={s.sign}>Le professeur principal</Text>
          <Text style={s.sign}>Le directeur</Text>
          <Text style={s.sign}>Signature des parents</Text>
        </View>
        <Text style={[s.small, { position: "absolute", bottom: 16, left: 28 }]}>
          Édité le {d.issuedAt} avec LAKOL — document à conserver
        </Text>
      </Page>
    </Document>
  );
}

export function renderReportCard(data: ReportCardPdfData): Promise<Buffer> {
  return renderToBuffer(<ReportCardDocument d={data} />);
}
