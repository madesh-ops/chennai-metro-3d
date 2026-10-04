export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatKm(metres: number, digits = 1): string {
  return (metres / 1000).toFixed(digits);
}

export function formatMinutes(seconds: number): string {
  return `${Math.round(seconds / 60)}`;
}
