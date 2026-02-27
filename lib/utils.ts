export function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function normalizeText(s: string) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function containsAny(text: string, needles: string[]) {
  const t = normalizeText(text);
  return needles.some(n => t.includes(normalizeText(n)));
}

export function uniq<T>(arr: T[]) {
  return Array.from(new Set(arr));
}

export function pickRandom<T>(arr: T[]) {
  return arr[Math.floor(Math.random() * arr.length)];
}
