// VS Code-style fuzzy matching for Quick Open and the command palette. Pure.
export type FuzzyMatch = { score: number; positions: number[] };

const SEP = /[\/\\._\- ]/;

export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = query.toLowerCase().replace(/\s+/g, "");
  if (!q) return { score: 0, positions: [] };
  const t = text.toLowerCase();
  const positions: number[] = [];
  let ti = 0;
  let score = 0;
  let prev = -2;
  for (const ch of q) {
    const idx = t.indexOf(ch, ti);
    if (idx === -1) return null;
    positions.push(idx);
    score += 1;
    if (idx === prev + 1) score += 4; // consecutive characters
    if (idx === 0 || SEP.test(text[idx - 1])) score += 3; // start of a path/word segment
    if (text[idx] === query[positions.length - 1] && text[idx] !== text[idx].toLowerCase()) score += 1; // case hit
    prev = idx;
    ti = idx + 1;
  }
  const base = text.slice(text.lastIndexOf("/") + 1).toLowerCase();
  if (base.includes(q)) score += 10; // whole query inside the file name
  if (base.startsWith(q)) score += 6;
  return { score: score - text.length * 0.02, positions };
}

export function fuzzyFilter<T>(items: T[], query: string, text: (i: T) => string, limit = 50): { item: T; match: FuzzyMatch }[] {
  const out: { item: T; match: FuzzyMatch }[] = [];
  for (const item of items) {
    const m = fuzzyMatch(query, text(item));
    if (m) out.push({ item, match: m });
  }
  return out.sort((a, b) => b.match.score - a.match.score).slice(0, limit);
}
