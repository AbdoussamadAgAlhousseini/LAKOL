// Graphiques légers en SVG, rendus côté serveur (aucune bibliothèque, rapides
// sur téléphone). Une seule série par graphique : la couleur de l'école,
// pas de légende ; le titre de la carte nomme la série. Info-bulle native au
// survol et tableau équivalent pour les lecteurs d'écran.

export interface Datum {
  label: string;
  value: number | null;
  /** Valeur affichée (info-bulle, étiquette, tableau). */
  display: string;
}

const H = 160;
const PAD = { top: 16, right: 8, bottom: 28, left: 8 };

function ScreenReaderTable({ caption, data }: { caption: string; data: Datum[] }) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <tbody>
        {data.map((d) => (
          <tr key={d.label}>
            <th scope="row">{d.label}</th>
            <td>{d.display}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Repère horizontal (ex. moyenne 10/20) : trait pointillé discret. */
function Reference({ y, width, label }: { y: number; width: number; label?: string }) {
  return (
    <g aria-hidden>
      <line
        x1={PAD.left}
        x2={width - PAD.right}
        y1={y}
        y2={y}
        className="stroke-muted-foreground/50"
        strokeDasharray="4 4"
        strokeWidth={1}
      />
      {label && (
        <text x={width - PAD.right} y={y - 4} textAnchor="end" className="fill-muted-foreground text-[10px]">
          {label}
        </text>
      )}
    </g>
  );
}

/**
 * Barres verticales (ex. moyenne par classe). Barres fines, sommet arrondi,
 * ancrées sur la ligne de base ; une valeur sous le repère est en couleur d'alerte.
 */
export function BarChart({
  data,
  max,
  caption,
  reference,
  alertBelow,
}: {
  data: Datum[];
  max: number;
  caption: string;
  reference?: { value: number; label: string };
  alertBelow?: number;
}) {
  const width = Math.max(240, data.length * 44);
  const plotW = width - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const slot = plotW / Math.max(1, data.length);
  const barW = Math.min(28, slot - 6);
  const y = (v: number) => PAD.top + plotH - (Math.min(v, max) / max) * plotH;
  const base = PAD.top + plotH;

  return (
    <figure className="flex flex-col gap-1">
      <svg viewBox={`0 0 ${width} ${H}`} className="h-44 w-full" role="img" aria-label={caption}>
        <line x1={PAD.left} x2={width - PAD.right} y1={base} y2={base} className="stroke-border" strokeWidth={1} />
        {reference && <Reference y={y(reference.value)} width={width} label={reference.label} />}
        {data.map((d, i) => {
          const cx = PAD.left + slot * i + slot / 2;
          const top = d.value === null ? base : y(d.value);
          const h = base - top;
          const alert = alertBelow !== undefined && d.value !== null && d.value < alertBelow;
          return (
            <g key={d.label}>
              <title>{`${d.label} : ${d.display}`}</title>
              {/* Zone de survol plus large que la barre */}
              <rect x={cx - slot / 2} y={PAD.top} width={slot} height={plotH} fill="transparent" />
              {h > 0 && (
                <path
                  d={`M${cx - barW / 2},${base} V${top + 4} q0,-4 4,-4 h${barW - 8} q4,0 4,4 V${base} Z`}
                  className={alert ? "fill-destructive" : "fill-primary"}
                />
              )}
              <text x={cx} y={H - 10} textAnchor="middle" className="fill-muted-foreground text-[10px]">
                {d.label.length > 7 ? `${d.label.slice(0, 6)}…` : d.label}
              </text>
            </g>
          );
        })}
      </svg>
      <ScreenReaderTable caption={caption} data={data} />
    </figure>
  );
}

/**
 * Courbe d'évolution (ex. moyenne par période, taux de présence par semaine).
 * Trait de 2 px, points de 8 px cerclés de la couleur du fond ; seule la
 * dernière valeur est étiquetée.
 */
export function LineChart({
  data,
  min,
  max,
  caption,
  reference,
}: {
  data: Datum[];
  min: number;
  max: number;
  caption: string;
  reference?: { value: number; label: string };
}) {
  const width = 320;
  const plotW = width - PAD.left - PAD.right - 24;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + 12 + (data.length === 1 ? plotW / 2 : (plotW * i) / (data.length - 1));
  const y = (v: number) => PAD.top + plotH - ((Math.max(min, Math.min(v, max)) - min) / (max - min)) * plotH;
  const points = data.map((d, i) => (d.value === null ? null : { x: x(i), y: y(d.value), d }));
  const path = points
    .filter((p): p is NonNullable<typeof p> => p !== null)
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`)
    .join(" ");
  const last = [...points].reverse().find((p) => p !== null);

  return (
    <figure className="flex flex-col gap-1">
      <svg viewBox={`0 0 ${width} ${H}`} className="h-44 w-full" role="img" aria-label={caption}>
        <line
          x1={PAD.left}
          x2={width - PAD.right}
          y1={PAD.top + plotH}
          y2={PAD.top + plotH}
          className="stroke-border"
          strokeWidth={1}
        />
        {reference && <Reference y={y(reference.value)} width={width} label={reference.label} />}
        {path && <path d={path} fill="none" className="stroke-primary" strokeWidth={2} strokeLinejoin="round" />}
        {points.map(
          (p) =>
            p && (
              <g key={p.d.label}>
                <title>{`${p.d.label} : ${p.d.display}`}</title>
                <circle cx={p.x} cy={p.y} r={14} fill="transparent" />
                <circle cx={p.x} cy={p.y} r={4} className="fill-primary stroke-card" strokeWidth={2} />
              </g>
            ),
        )}
        {last && (
          <text x={last.x} y={last.y - 10} textAnchor="middle" className="fill-foreground text-[11px] font-semibold">
            {last.d.display}
          </text>
        )}
        {data.map((d, i) => (
          <text key={d.label} x={x(i)} y={H - 10} textAnchor="middle" className="fill-muted-foreground text-[10px]">
            {d.label}
          </text>
        ))}
      </svg>
      <ScreenReaderTable caption={caption} data={data} />
    </figure>
  );
}
