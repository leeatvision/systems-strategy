import brand from "../brand/brand.json";

// Optional wording from the brand file: { "terms": { "Goal": "…", "Goals": "…" } }.
// The app is written with its own words; a brand can swap any of them for its own.
// Only on-screen wording passes through here, never codes, routes or what people type.
const terms = (brand as unknown as { terms?: Record<string, string> }).terms ?? {};
const keys = Object.keys(terms).filter((k) => !k.startsWith("_")).sort((a, b) => b.length - a.length);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const pattern = keys.length ? new RegExp(`\\b(${keys.map(escape).join("|")})\\b`, "gi") : null;
const lookup = new Map(keys.map((k) => [k.toLowerCase(), terms[k]]));

/** The brand's wording for a piece of on-screen text. */
export function w(text: string): string;
export function w(text: string | null | undefined): string | null | undefined;
export function w(text: string | null | undefined) {
  if (!pattern || !text) return text;
  return text.replace(pattern, (m) => lookup.get(m.toLowerCase()) ?? m);
}
