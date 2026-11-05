const numbers = new Intl.NumberFormat("fr-FR");

export function formatNumber(value: number): string {
  return numbers.format(value);
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${formatNumber(count)} ${count > 1 ? pluralForm : singular}`;
}

export function formatCost(value: number | null | undefined): string {
  return typeof value === "number" ? `~${value.toFixed(2).replace(".", ",")} $` : "coût inconnu";
}
