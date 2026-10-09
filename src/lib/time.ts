// Heures en minutes depuis minuit (08:30 -> 510) ; jours ISO (1 = lundi … 7 = dimanche).

export function formatTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function parseTime(value: string): number | null {
  const m = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

/** Deux plages se chevauchent (bornes de fin exclues). */
export function overlaps(a: { startMin: number; endMin: number }, b: { startMin: number; endMin: number }) {
  return a.startMin < b.endMin && b.startMin < a.endMin;
}

/** Date UTC à minuit. */
export function dayStart(date: Date = new Date()): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

/** Jour ISO (1 = lundi … 7 = dimanche). */
export function isoDay(date: Date): number {
  return ((date.getUTCDay() + 6) % 7) + 1;
}

/** Lundi de la semaine de la date. */
export function weekStart(date: Date = new Date()): Date {
  return addDays(dayStart(date), 1 - isoDay(date));
}

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function parseIsoDate(value: string | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}
