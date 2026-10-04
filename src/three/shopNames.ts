import { mulberry32, type Rng } from "../utils/random.ts";

/**
 * Invented Chennai shop names for the street signboards: a common name or
 * blessing plus a trade, in English with the Tamil the way signboards
 * usually write it (trades are mostly transliterated English). Names that
 * match a real chain or brand are rejected, so no real business appears.
 */

export interface Word {
  en: string;
  ta: string;
}

export interface Trade extends Word {
  /** Board background, text and accent colours. */
  bg: string;
  fg: string;
  accent: string;
}

export const PREFIXES: readonly Word[] = [
  { en: "Sri Lakshmi", ta: "ஸ்ரீ லட்சுமி" },
  { en: "Annai", ta: "அன்னை" },
  { en: "Thirumalai", ta: "திருமலை" },
  { en: "Vel", ta: "வேல்" },
  { en: "Kaveri", ta: "காவேரி" },
  { en: "Selvam", ta: "செல்வம்" },
  { en: "New Royal", ta: "நியூ ராயல்" },
  { en: "Sri Balaji", ta: "ஸ்ரீ பாலாஜி" },
  { en: "Ganesh", ta: "கணேஷ்" },
  { en: "Mahalakshmi", ta: "மகாலட்சுமி" },
  { en: "Arul", ta: "அருள்" },
  { en: "Anbu", ta: "அன்பு" },
  { en: "Ponni", ta: "பொன்னி" },
  { en: "Kalaivani", ta: "கலைவாணி" },
  { en: "Sri Devi", ta: "ஸ்ரீ தேவி" },
  { en: "Senthil", ta: "செந்தில்" },
  { en: "Star", ta: "ஸ்டார்" },
  { en: "Golden", ta: "கோல்டன்" },
  { en: "Vijay", ta: "விஜய்" },
  { en: "Amman", ta: "அம்மன்" },
  { en: "Raja", ta: "ராஜா" },
  { en: "Sakthi", ta: "சக்தி" },
  { en: "Malar", ta: "மலர்" },
  { en: "Sri Ram", ta: "ஸ்ரீ ராம்" },
];

const YELLOW = { bg: "#f2c230", fg: "#a61e1e", accent: "#a61e1e" };
const GREEN = { bg: "#17784a", fg: "#ffffff", accent: "#f5d547" };
const MAROON = { bg: "#6b1420", fg: "#f2c94c", accent: "#f2c94c" };
const PINK = { bg: "#a8205e", fg: "#ffffff", accent: "#ffd166" };
const BLUE = { bg: "#1d4fb8", fg: "#ffffff", accent: "#ffd166" };
const RED = { bg: "#c62828", fg: "#ffffff", accent: "#ffe082" };
const ORANGE = { bg: "#e46f1f", fg: "#ffffff", accent: "#fff3c4" };
const WHITE = { bg: "#f4f4f0", fg: "#14306b", accent: "#c62828" };
const SKY = { bg: "#dff1fb", fg: "#123b5a", accent: "#e46f1f" };
const TEAL = { bg: "#0f6e73", fg: "#ffffff", accent: "#ffd166" };

export const TRADES: readonly Trade[] = [
  { en: "Textiles", ta: "டெக்ஸ்டைல்ஸ்", ...PINK },
  { en: "Silks", ta: "சில்க்ஸ்", ...MAROON },
  { en: "Readymades", ta: "ரெடிமேட்ஸ்", ...PINK },
  { en: "Medicals", ta: "மெடிக்கல்ஸ்", ...GREEN },
  { en: "Clinic", ta: "கிளினிக்", ...WHITE },
  { en: "Jewellers", ta: "ஜுவல்லர்ஸ்", ...MAROON },
  { en: "Tiffin Centre", ta: "டிபன் சென்டர்", ...YELLOW },
  { en: "Mess", ta: "மெஸ்", ...YELLOW },
  { en: "Tea Stall", ta: "டீ ஸ்டால்", ...YELLOW },
  { en: "Hotel", ta: "ஹோட்டல்", ...ORANGE },
  { en: "Bakery", ta: "பேக்கரி", ...ORANGE },
  { en: "Sweets", ta: "ஸ்வீட்ஸ்", ...ORANGE },
  { en: "Hardwares", ta: "ஹார்டுவேர்ஸ்", ...RED },
  { en: "Paints", ta: "பெயிண்ட்ஸ்", ...RED },
  { en: "Electricals", ta: "எலக்ட்ரிகல்ஸ்", ...RED },
  { en: "Mobiles", ta: "மொபைல்ஸ்", ...BLUE },
  { en: "Opticals", ta: "ஆப்டிகல்ஸ்", ...WHITE },
  { en: "Xerox", ta: "ஜெராக்ஸ்", ...SKY },
  { en: "Book Centre", ta: "புக் சென்டர்", ...SKY },
  { en: "Stores", ta: "ஸ்டோர்ஸ்", ...TEAL },
  { en: "Traders", ta: "டிரேடர்ஸ்", ...TEAL },
  { en: "Fancy Store", ta: "ஃபேன்சி ஸ்டோர்", ...BLUE },
  { en: "Furniture", ta: "ஃபர்னிச்சர்", ...TEAL },
];

/**
 * Real chains and brands (lower case). Any invented name containing one is
 * rejected. Prefix words that only ever appear in brands are left out of
 * PREFIXES as well (e.g. Saravana, Kumaran, Murugan, Krishna).
 */
export const BLOCKLIST: readonly string[] = [
  "saravana", "krishna sweets", "kumaran", "nalli", "pothys", "adyar ananda", "ananda bhavan", "a2b",
  "anjappar", "lalitha", "vasanth", "murugan idli", "sangeetha", "grand sweets", "hot chips",
  "thalappakatti", "ratna", "joyalukkas", "grt", "khazana", "chennai silks", "rmkv", "jayachandran",
  "sri kumaran", "aachi", "sakthi masala", "star bakery", "golden jewellers", "raja sweets", "amman sweets",
];

export interface ShopName {
  en: string;
  ta: string;
  trade: Trade;
}

export const isBlocked = (name: string) => {
  const n = name.toLowerCase();
  return BLOCKLIST.some((b) => n.includes(b));
};

export function shopName(rng: Rng): ShopName {
  for (;;) {
    const p = PREFIXES[Math.floor(rng() * PREFIXES.length)];
    const t = TRADES[Math.floor(rng() * TRADES.length)];
    const en = `${p.en} ${t.en}`;
    if (!isBlocked(en)) return { en, ta: `${p.ta} ${t.ta}`, trade: t };
  }
}

/** Number of distinct boards in the sign atlas (4 columns × 20 rows). */
export const SIGN_COLS = 4;
export const SIGN_ROWS = 20;
export const SIGN_CELLS = SIGN_COLS * SIGN_ROWS;

/** The fixed set of boards drawn into the atlas: unique names, same on every load. */
export function signAtlasNames(seed = 600026): ShopName[] {
  const rng = mulberry32(seed);
  const seen = new Set<string>();
  const out: ShopName[] = [];
  while (out.length < SIGN_CELLS) {
    const n = shopName(rng);
    if (seen.has(n.en)) continue;
    seen.add(n.en);
    out.push(n);
  }
  return out;
}
