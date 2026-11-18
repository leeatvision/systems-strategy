import brand from "../brand/brand.json";

// Optional wording from the brand file:
//   "terms":     { "Goal": "…", "Goals": "…" }   the brand's word, used everywhere
//   "termsLong": { "Vision and Plan": "…" }       a fuller name, used on that thing's own page
// The app is written with its own words; a brand can swap any of them for its own.
// Only on-screen wording passes through here, never codes, routes or what people type.
type Map_ = Record<string, string>;
const b = brand as unknown as { terms?: Map_; termsLong?: Map_ };

function swapper(terms: Map_) {
  const keys = Object.keys(terms).filter((k) => !k.startsWith("_")).sort((a, z) => z.length - a.length);
  if (!keys.length) return (text: string) => text;
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`\\b(${keys.map(escape).join("|")})\\b`, "gi");
  const lookup = new Map(keys.map((k) => [k.toLowerCase(), terms[k]]));
  return (text: string) => text.replace(pattern, (m) => lookup.get(m.toLowerCase()) ?? m);
}
const short = swapper(b.terms ?? {});
const long = swapper(b.termsLong ?? {});

/** The brand's wording for a piece of on-screen text. */
export function w(text: string): string;
export function w(text: string | null | undefined): string | null | undefined;
export function w(text: string | null | undefined) {
  return text ? short(text) : text;
}

/** Same, but using the brand's fuller names where it has them (for a thing's own page). */
export function wLong(text: string): string;
export function wLong(text: string | null | undefined): string | null | undefined;
export function wLong(text: string | null | undefined) {
  return text ? short(long(text)) : text;
}
