const numbers = new Intl.NumberFormat("fr-FR");

export function formatNumber(value: number): string {
  return numbers.format(value);
}

export function formatTime(seconds: number): string {
  return new Date(seconds * 1000).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${formatNumber(count)} ${count > 1 ? pluralForm : singular}`;
}

export function formatCost(value: number | null | undefined): string {
  return typeof value === "number" ? `~${value.toFixed(2).replace(".", ",")} $` : "coût inconnu";
}
