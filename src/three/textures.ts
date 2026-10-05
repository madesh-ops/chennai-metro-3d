import {
  CanvasTexture,
  ClampToEdgeWrapping,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from "three";
import { mulberry32 } from "../utils/random.ts";
import { SIGN_COLS, SIGN_ROWS, shopName, type ShopName } from "./shopNames.ts";

/**
 * All textures are drawn procedurally into canvases at runtime: no image
 * downloads, no licensing questions, and they stay crisp at any size.
 */

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  return { c, ctx };
}

function finish(c: HTMLCanvasElement, repeat = true, srgb = true): CanvasTexture {
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = repeat ? RepeatWrapping : ClampToEdgeWrapping;
  t.minFilter = LinearMipmapLinearFilter;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

function speckle(ctx: CanvasRenderingContext2D, w: number, h: number, seed: number, n: number, alpha: number) {
  const rng = mulberry32(seed);
  for (let i = 0; i < n; i++) {
    const v = Math.floor(rng() * 255);
    ctx.fillStyle = `rgba(${v},${v},${v},${alpha * rng()})`;
    ctx.fillRect(rng() * w, rng() * h, 1 + rng() * 2, 1 + rng() * 2);
  }
}

/**
 * Six-lane carriageway, 26 m wide. U runs along the road (12 m per repeat),
 * V across it. Canvas y maps to lateral position (l + 13) / 26.
 */
export function makeRoadTexture(): Texture {
  const W = 256;
  const H = 512;
  const { c, ctx } = canvas(W, H);
  ctx.fillStyle = "#3a3d42";
  ctx.fillRect(0, 0, W, H);
  speckle(ctx, W, H, 11, 9000, 0.18);
  const y = (l: number) => ((l + 13) / 26) * H;
  // Tyre wear bands slightly lighter.
  ctx.fillStyle = "rgba(255,255,255,0.035)";
  for (const lane of [2.95, 6.45, 9.95]) {
    for (const s of [-1, 1]) {
      ctx.fillRect(0, y(s * lane - 1.0) - 6, W, 12);
      ctx.fillRect(0, y(s * lane + 1.0) - 6, W, 12);
    }
  }
  ctx.fillStyle = "rgba(235,235,225,0.85)";
  // Solid edge lines.
  for (const l of [-11.7, 11.7]) ctx.fillRect(0, y(l) - 2, W, 4);
  // Dashed lane dividers: 3 m dash, 9 m gap.
  for (const l of [-8.2, -4.7, 4.7, 8.2]) ctx.fillRect(0, y(l) - 1.5, W * 0.25, 3);
  // Median kerb shadow.
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.fillRect(0, y(-1.3), W, y(1.3) - y(-1.3));
  return finish(c);
}

/**
 * Four-lane flyover deck between its outer barriers (16 m): two lanes each
 * way either side of a median barrier. U along the deck (12 m per repeat),
 * V across it; canvas y maps to lateral position (l + 8) / 16.
 */
export function makeFlyoverTexture(): Texture {
  const W = 256;
  const H = 512;
  const { c, ctx } = canvas(W, H);
  ctx.fillStyle = "#3d4045";
  ctx.fillRect(0, 0, W, H);
  speckle(ctx, W, H, 23, 7000, 0.18);
  const y = (l: number) => ((l + 8) / 16) * H;
  ctx.fillStyle = "rgba(255,255,255,0.035)";
  for (const lane of [2.2, 6.0]) for (const s of [-1, 1]) {
    ctx.fillRect(0, y(s * lane - 0.9) - 6, W, 12);
    ctx.fillRect(0, y(s * lane + 0.9) - 6, W, 12);
  }
  ctx.fillStyle = "rgba(235,235,225,0.85)";
  for (const l of [-7.7, -0.65, 0.65, 7.7]) ctx.fillRect(0, y(l) - 2, W, 4);
  for (const l of [-4.1, 4.1]) ctx.fillRect(0, y(l) - 1.5, W * 0.25, 3);
  return finish(c);
}

/** Ballastless track slab: plinths every 0.65 m. U along the track, V across 3 m. */
export function makeTrackBedTexture(): Texture {
  const W = 64;
  const H = 128;
  const { c, ctx } = canvas(W, H);
  ctx.fillStyle = "#8a8b88";
  ctx.fillRect(0, 0, W, H);
  speckle(ctx, W, H, 5, 900, 0.25);
  ctx.fillStyle = "#6d6e6c";
  // Plinth block under each rail (rails at ~0.24 and ~0.76 of the width).
  for (const v of [0.24, 0.76]) ctx.fillRect(W * 0.12, H * (v - 0.12), W * 0.6, H * 0.24);
  ctx.fillStyle = "#2c2d2f";
  for (const v of [0.24, 0.76]) ctx.fillRect(W * 0.3, H * (v - 0.04), W * 0.22, H * 0.08);
  return finish(c);
}

export function makeGroundTexture(): Texture {
  const S = 512;
  const { c, ctx } = canvas(S, S);
  ctx.fillStyle = "#8f8a7c";
  ctx.fillRect(0, 0, S, S);
  const rng = mulberry32(99);
  for (let i = 0; i < 260; i++) {
    const r = 10 + rng() * 60;
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    const tone = rng() > 0.5 ? "120,128,96" : "160,150,128";
    g.addColorStop(0, `rgba(${tone},${0.18 + rng() * 0.2})`);
    g.addColorStop(1, `rgba(${tone},0)`);
    ctx.save();
    ctx.translate(rng() * S, rng() * S);
    ctx.fillStyle = g;
    ctx.fillRect(-r, -r, r * 2, r * 2);
    ctx.restore();
  }
  speckle(ctx, S, S, 7, 26000, 0.12);
  return finish(c);
}

export function makeConcreteTexture(): Texture {
  const S = 256;
  const { c, ctx } = canvas(S, S);
  ctx.fillStyle = "#b9b8b2";
  ctx.fillRect(0, 0, S, S);
  speckle(ctx, S, S, 21, 6000, 0.15);
  // Faint monsoon streaks.
  const rng = mulberry32(4);
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(60,60,55,${0.03 + rng() * 0.05})`;
    ctx.fillRect(rng() * S, 0, 1 + rng() * 3, S * (0.3 + rng() * 0.7));
  }
  return finish(c);
}

export function makeRadialTexture(): Texture {
  const S = 128;
  const { c, ctx } = canvas(S, S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,255,255,0.5)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return finish(c, false);
}

function cssVar(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export function fontFamilies() {
  return {
    sans: cssVar("--font-geist-sans", "system-ui, sans-serif"),
    tamil: cssVar("--font-tamil", "'Noto Sans Tamil', sans-serif"),
  };
}

/** Make sure web fonts are ready before rasterising text into canvases. */
export async function ensureFontsLoaded(): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  const f = fontFamilies();
  try {
    await Promise.race([
      Promise.all([
        document.fonts.load(`600 64px ${f.sans}`),
        document.fonts.load(`500 64px ${f.tamil}`, "பூந்தமல்லி"),
      ]),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
  } catch {
    // Fall back to system fonts.
  }
}

/** Platform name board: English over Tamil, line-colour accent. */
export function makeStationSignTexture(name: string, nameTa: string | null, lineColour: string, lit: boolean): Texture {
  const W = 1024;
  const H = 256;
  const { c, ctx } = canvas(W, H);
  const f = fontFamilies();
  ctx.fillStyle = "#0d1724";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = lineColour;
  ctx.fillRect(0, 0, 22, H);
  ctx.fillStyle = lit ? "#f5f7fa" : "#7d8794";
  ctx.textBaseline = "alphabetic";
  let size = 96;
  ctx.font = `600 ${size}px ${f.sans}`;
  const label = name.toUpperCase();
  while (ctx.measureText(label).width > W - 110 && size > 40) {
    size -= 4;
    ctx.font = `600 ${size}px ${f.sans}`;
  }
  ctx.fillText(label, 62, nameTa ? 128 : 160);
  if (nameTa) {
    let ts = 62;
    ctx.font = `500 ${ts}px ${f.tamil}`;
    while (ctx.measureText(nameTa).width > W - 110 && ts > 28) {
      ts -= 3;
      ctx.font = `500 ${ts}px ${f.tamil}`;
    }
    ctx.fillStyle = lit ? "#c9d1dc" : "#6b7480";
    ctx.fillText(nameTa, 62, 214);
  }
  return finish(c, false);
}

/** Amber LED destination display. */
export function makeDestinationTexture(text: string): Texture {
  const W = 512;
  const H = 96;
  const { c, ctx } = canvas(W, H);
  const f = fontFamilies();
  ctx.fillStyle = "#050505";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#ffb347";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  let size = 58;
  ctx.font = `600 ${size}px ${f.sans}`;
  const label = text.toUpperCase();
  while (ctx.measureText(label).width > W - 30 && size > 24) {
    size -= 2;
    ctx.font = `600 ${size}px ${f.sans}`;
  }
  ctx.fillText(label, W / 2, H / 2 + 2);
  // LED dot mask.
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1);
  for (let x = 0; x < W; x += 4) ctx.fillRect(x, 0, 1, H);
  return finish(c, false);
}

/** Shrink a font until the text fits the width. */
function fitFont(ctx: CanvasRenderingContext2D, text: string, weight: number, family: string, size: number, min: number, width: number) {
  // Text width scales with font size: one measurement gives the size, a check or two
  // covers rounding (setting ctx.font is slow, so no 1 px search).
  ctx.font = `${weight} ${size}px ${family}`;
  const w = ctx.measureText(text).width;
  if (w <= width) return size;
  let px = Math.max(min, Math.floor((size * width) / w));
  ctx.font = `${weight} ${px}px ${family}`;
  while (px > min && ctx.measureText(text).width > width) {
    px -= 1;
    ctx.font = `${weight} ${px}px ${family}`;
  }
  return px;
}

/**
 * Shop signboards: one atlas of SIGN_COLS × SIGN_ROWS boards, each an
 * invented name in English with Tamil below, in its trade's colours.
 */
export function makeSignAtlasTexture(names: readonly ShopName[]): Texture {
  const W = 2048;
  const CW = W / SIGN_COLS;
  const CH = 102;
  const { c, ctx } = canvas(W, CH * SIGN_ROWS);
  const f = fontFamilies();
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  names.forEach((n, i) => {
    const x = (i % SIGN_COLS) * CW;
    const y = Math.floor(i / SIGN_COLS) * CH;
    const t = n.trade;
    ctx.fillStyle = t.bg;
    ctx.fillRect(x, y, CW, CH);
    // Painted border and accent rule, like a flex-printed board.
    ctx.strokeStyle = t.accent;
    ctx.lineWidth = 4;
    ctx.strokeRect(x + 5, y + 5, CW - 10, CH - 10);
    ctx.fillStyle = t.accent;
    ctx.fillRect(x + 40, y + 57, CW - 80, 2);
    ctx.fillStyle = t.fg;
    const label = n.en.toUpperCase();
    fitFont(ctx, label, 700, f.sans, 40, 22, CW - 40);
    ctx.fillText(label, x + CW / 2, y + 50);
    fitFont(ctx, n.ta, 600, f.tamil, 27, 16, CW - 40);
    ctx.fillText(n.ta, x + CW / 2, y + 88);
  });
  const tex = finish(c, false);
  tex.anisotropy = 8;
  return tex;
}

export type BoardStyle = "temple" | "civic" | "transport" | "nature";

const BOARD_STYLES: Record<BoardStyle, { bg: string; fg: string; sub: string; accent: string }> = {
  temple: { bg: "#7a1d12", fg: "#ffd36b", sub: "#ffe8b0", accent: "#f0a020" },
  civic: { bg: "#f7f7f2", fg: "#14306b", sub: "#2d4a80", accent: "#c62828" },
  transport: { bg: "#13579b", fg: "#ffffff", sub: "#d8e8ff", accent: "#ffd166" },
  nature: { bg: "#1f5a3a", fg: "#ffffff", sub: "#d6f0de", accent: "#9fd48a" },
};

/** Name board for a real public landmark: English over Tamil. */
export function makeNameBoardTexture(name: string, nameTa: string | null, style: BoardStyle): Texture {
  const W = 1024;
  const H = 256;
  const { c, ctx } = canvas(W, H);
  const f = fontFamilies();
  const st = BOARD_STYLES[style];
  ctx.fillStyle = st.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = st.accent;
  ctx.lineWidth = 10;
  ctx.strokeRect(12, 12, W - 24, H - 24);
  ctx.textAlign = "center";
  ctx.fillStyle = st.fg;
  const label = name.toUpperCase();
  fitFont(ctx, label, 700, f.sans, 84, 36, W - 90);
  ctx.fillText(label, W / 2, nameTa ? 120 : 160);
  if (nameTa) {
    ctx.fillStyle = st.sub;
    fitFont(ctx, nameTa, 600, f.tamil, 64, 28, W - 90);
    ctx.fillText(nameTa, W / 2, 212);
  }
  return finish(c, false);
}

/* ------------------------------------------------------------------ */
/* Mall and cinema panels (Vadapalani). Ads and films are invented.    */
/* ------------------------------------------------------------------ */

/** "NEXUS VIJAYA" box sign, English over Tamil. */
function mallSign(): Texture {
  const W = 1024;
  const H = 256;
  const { c, ctx } = canvas(W, H);
  const f = fontFamilies();
  ctx.fillStyle = "#f7f8f9";
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = "center";
  ctx.fillStyle = "#1b2a44";
  fitFont(ctx, "NEXUS VIJAYA", 800, f.sans, 118, 40, W - 80);
  ctx.fillText("NEXUS VIJAYA", W / 2, 140);
  ctx.fillStyle = "#c0392b";
  fitFont(ctx, "நெக்சஸ் விஜயா மால்", 600, f.tamil, 52, 24, W - 120);
  ctx.fillText("நெக்சஸ் விஜயா மால்", W / 2, 220);
  return finish(c, false);
}

/** Kamala Cinemas name sign: Tamil, emblem gap, English. */
function kamalaSign(): Texture {
  const W = 1024;
  const H = 128;
  const { c, ctx } = canvas(W, H);
  const f = fontFamilies();
  ctx.fillStyle = "#f4f1ea";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#b3261e";
  ctx.textBaseline = "middle";
  ctx.textAlign = "right";
  fitFont(ctx, "கமலா", 700, f.tamil, 78, 30, W / 2 - 80);
  ctx.fillText("கமலா", W / 2 - 60, H / 2 + 4);
  ctx.textAlign = "left";
  fitFont(ctx, "KAMALA", 800, f.sans, 84, 30, W / 2 - 80);
  ctx.fillText("KAMALA", W / 2 + 60, H / 2 + 4);
  return finish(c, false);
}

/** Chandra Metro Mall name sign: Tamil above, English below, on dark slate. */
function chandraSign(): Texture {
  const W = 1024;
  const H = 280;
  const { c, ctx } = canvas(W, H);
  const f = fontFamilies();
  ctx.fillStyle = "#2f3438";
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = "center";
  ctx.fillStyle = "#f2f2ee";
  fitFont(ctx, "சந்திரா மெட்ரோ வணிகவளாகம்", 600, f.tamil, 70, 26, W - 90);
  ctx.fillText("சந்திரா மெட்ரோ வணிகவளாகம்", W / 2, 100);
  // The real sign uses a slanted serif script.
  fitFont(ctx, "Chandra Metro Mall", 700, "Georgia, 'Times New Roman', serif", 96, 36, W - 80);
  ctx.font = `italic ${ctx.font}`;
  ctx.fillText("Chandra Metro Mall", W / 2, 222);
  return finish(c, false);
}

const AD_COPY = [
  ["MEGA SALE", "FLAT 50% OFF"],
  ["NEW ARRIVALS", "FESTIVE COLLECTION"],
  ["5G PHONES", "FROM ₹9,999"],
  ["SUMMER OFFERS", "BUY 2 GET 1"],
  ["GOLD FESTIVAL", "ZERO MAKING CHARGES*"],
  ["FAMILY SUV", "BOOK A TEST DRIVE"],
];
const AD_STYLES = [
  { bg: ["#c62828", "#ff7043"], fg: "#ffffff", accent: "#ffd54f" },
  { bg: ["#0d47a1", "#42a5f5"], fg: "#ffffff", accent: "#ffeb3b" },
  { bg: ["#4a148c", "#ec407a"], fg: "#ffffff", accent: "#fff59d" },
  { bg: ["#1b5e20", "#9ccc65"], fg: "#ffffff", accent: "#fffde7" },
  { bg: ["#f5f5f5", "#cfd8dc"], fg: "#1a237e", accent: "#e53935" },
];

/** An invented advert: gradient, bold copy, a made-up brand from the shop-name tables. */
function hoarding(seed: number): Texture {
  const rng = mulberry32(seed * 7919 + 13);
  const W = 512;
  const H = 640;
  const { c, ctx } = canvas(W, H);
  const f = fontFamilies();
  const st = AD_STYLES[Math.floor(rng() * AD_STYLES.length)];
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, st.bg[0]);
  g.addColorStop(1, st.bg[1]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // Bold graphic shapes.
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = st.accent;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.arc(rng() * W, rng() * H, 60 + rng() * 160, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  const [l1, l2] = AD_COPY[Math.floor(rng() * AD_COPY.length)];
  const brand = shopName(rng);
  ctx.textAlign = "center";
  ctx.fillStyle = st.fg;
  fitFont(ctx, l1, 900, f.sans, 92, 40, W - 50);
  ctx.fillText(l1, W / 2, 190);
  ctx.fillStyle = st.accent;
  fitFont(ctx, l2, 800, f.sans, 60, 28, W - 50);
  ctx.fillText(l2, W / 2, 270);
  // Brand strip.
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.fillRect(0, H - 150, W, 150);
  ctx.fillStyle = "#1b1b1b";
  fitFont(ctx, brand.en.toUpperCase(), 800, f.sans, 48, 22, W - 40);
  ctx.fillText(brand.en.toUpperCase(), W / 2, H - 88);
  fitFont(ctx, brand.ta, 600, f.tamil, 34, 18, W - 40);
  ctx.fillText(brand.ta, W / 2, H - 38);
  return finish(c, false);
}

/** Invented film titles (English transliteration + Tamil), themed on the ride. */
const FILMS: [string, string][] = [
  ["METRO KAADHAL", "மெட்ரோ காதல்"],
  ["IRAVU RAIL", "இரவு ரயில்"],
  ["ARCOT EXPRESS", "ஆற்காடு எக்ஸ்பிரஸ்"],
  ["MANJAL KODU", "மஞ்சள் கோடு"],
  ["NILA PAYANAM", "நிலா பயணம்"],
  ["PORUR POLICE", "போரூர் போலீஸ்"],
  ["KADAISI STOP", "கடைசி ஸ்டாப்"],
];

/** An invented film poster: dramatic gradient, sun halo, figure silhouettes, title. */
function filmPoster(seed: number, wide: boolean): Texture {
  const rng = mulberry32(seed * 104729 + 7);
  const W = wide ? 1024 : 384;
  const H = wide ? 340 : 400;
  const { c, ctx } = canvas(W, H);
  const f = fontFamilies();
  const palettes = [
    ["#2b0a0a", "#c0392b", "#f5b041"],
    ["#0b1a33", "#2e86c1", "#f7dc6f"],
    ["#1c0f2e", "#8e44ad", "#f1948a"],
    ["#0d2316", "#229954", "#f9e79f"],
    ["#2e1a05", "#d35400", "#fdebd0"],
  ];
  const [dark, mid, light] = palettes[Math.floor(rng() * palettes.length)];
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, mid);
  g.addColorStop(1, dark);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // Sun / halo.
  const hx = W * (wide ? 0.72 : 0.5);
  const hy = H * 0.38;
  const halo = ctx.createRadialGradient(hx, hy, 4, hx, hy, H * 0.45);
  halo.addColorStop(0, light);
  halo.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, W, H);
  // Figure silhouettes.
  ctx.fillStyle = "rgba(10,8,8,0.88)";
  const figs = wide ? 3 : 2;
  for (let i = 0; i < figs; i++) {
    const fx = (wide ? W * 0.55 : W * 0.3) + i * (wide ? 120 : 130) + rng() * 20;
    const scale = (wide ? 0.9 : 1) * (0.8 + rng() * 0.35);
    const top = H * (0.32 + rng() * 0.08);
    ctx.beginPath();
    ctx.arc(fx, top, 26 * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(fx - 50 * scale, H);
    ctx.lineTo(fx - 34 * scale, top + 34 * scale);
    ctx.lineTo(fx + 34 * scale, top + 34 * scale);
    ctx.lineTo(fx + 50 * scale, H);
    ctx.closePath();
    ctx.fill();
  }
  const [en, ta] = FILMS[Math.floor(rng() * FILMS.length)];
  ctx.textAlign = wide ? "left" : "center";
  const tx = wide ? 40 : W / 2;
  ctx.fillStyle = light;
  fitFont(ctx, ta, 800, f.tamil, wide ? 70 : 46, 20, wide ? W * 0.5 : W - 30);
  ctx.fillText(ta, tx, wide ? 120 : H - 88);
  ctx.fillStyle = "#ffffff";
  fitFont(ctx, en, 900, f.sans, wide ? 58 : 36, 16, wide ? W * 0.5 : W - 30);
  ctx.fillText(en, tx, wide ? 190 : H - 46);
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.font = `600 ${wide ? 26 : 18}px ${f.sans}`;
  ctx.fillText("NOW SHOWING  •  U/A", tx, wide ? 250 : H - 18);
  return finish(c, false);
}

/** Texture for a commercial-model panel key: mall-sign, kamala-sign, chandra-sign, hoarding:N, poster:N, poster-wide:N. */
export function makeLandmarkPanelTexture(key: string): Texture {
  const [kind, n] = key.split(":");
  const seed = Number(n) || 0;
  switch (kind) {
    case "mall-sign":
      return mallSign();
    case "kamala-sign":
      return kamalaSign();
    case "chandra-sign":
      return chandraSign();
    case "poster":
      return filmPoster(seed, false);
    case "poster-wide":
      return filmPoster(seed, true);
    case "hoarding":
    default:
      return hoarding(seed);
  }
}

/* ------------------------------------------------------------------ */
/* In-car LED displays (passenger information).                         */
/* ------------------------------------------------------------------ */

const LED_W = 1024;
const LED_H = 160;
const LED_AMBER = "#ffb347";

/** Amber dot-matrix text strip; redraw with drawLedText(). */
export function makeLedTextTexture(): CanvasTexture {
  const { c } = canvas(LED_W, LED_H);
  const tex = finish(c, false);
  drawLedText(tex, "");
  return tex;
}

/** Redraw an LED text strip (one line, shrunk to fit, Tamil-aware). */
export function drawLedText(tex: CanvasTexture, text: string) {
  const c = tex.image as HTMLCanvasElement;
  const ctx = c.getContext("2d");
  if (!ctx) return;
  const f = fontFamilies();
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "#050505";
  ctx.fillRect(0, 0, LED_W, LED_H);
  ctx.fillStyle = LED_AMBER;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const tamil = /[஀-௿]/.test(text);
  fitFont(ctx, text, tamil ? 600 : 700, tamil ? f.tamil : f.sans, tamil ? 72 : 84, 26, LED_W - 60);
  ctx.fillText(text, LED_W / 2, LED_H / 2 + 4);
  // Dot-matrix mask.
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  for (let y = 0; y < LED_H; y += 5) ctx.fillRect(0, y, LED_W, 1.5);
  for (let x = 0; x < LED_W; x += 5) ctx.fillRect(x, 0, 1.5, LED_H);
  ctx.globalCompositeOperation = "source-over";
  tex.needsUpdate = true;
}

export interface RouteMapItem {
  name: string;
  /** "stop" = served, "pass" = not yet open (hollow LED). */
  kind: "stop" | "pass";
  state: "passed" | "current" | "ahead";
}

const MAP_W = 2048;
const MAP_H = 192;

/** Route-map strip above the doors; redraw with drawRouteMap(). */
export function makeRouteMapTexture(): CanvasTexture {
  const { c } = canvas(MAP_W, MAP_H);
  const tex = finish(c, false);
  drawRouteMap(tex, [], true, "#F2B705");
  return tex;
}

/** Stations left to right in travel order; the current one blinks (blinkOn toggles). */
export function drawRouteMap(tex: CanvasTexture, items: readonly RouteMapItem[], blinkOn: boolean, lineColour: string) {
  const c = tex.image as HTMLCanvasElement;
  const ctx = c.getContext("2d");
  if (!ctx) return;
  const f = fontFamilies();
  ctx.fillStyle = "#f4f5f2";
  ctx.fillRect(0, 0, MAP_W, MAP_H);
  ctx.fillStyle = lineColour;
  ctx.fillRect(0, 0, MAP_W, 10);
  const n = items.length;
  if (n >= 1) {
    const pad = 70;
    const xs = (i: number) => (n === 1 ? MAP_W / 2 : pad + ((MAP_W - 2 * pad) * i) / (n - 1));
    const y = MAP_H / 2 + 6;
    // Line: travelled part grey, the rest in the line colour.
    const cur = Math.max(0, items.findIndex((it) => it.state === "current"));
    ctx.lineWidth = 12;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#b9bdc2";
    ctx.beginPath();
    ctx.moveTo(xs(0), y);
    ctx.lineTo(xs(cur), y);
    ctx.stroke();
    ctx.strokeStyle = lineColour;
    ctx.beginPath();
    ctx.moveTo(xs(cur), y);
    ctx.lineTo(xs(n - 1), y);
    ctx.stroke();
    items.forEach((it, i) => {
      const x = xs(i);
      const r = it.kind === "stop" ? 15 : 10;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      if (it.kind === "pass") {
        ctx.fillStyle = "#f4f5f2";
        ctx.fill();
        ctx.lineWidth = 4;
        ctx.strokeStyle = it.state === "passed" ? "#c3c6ca" : "#8a9099";
        ctx.stroke();
      } else {
        const lit = it.state === "ahead" || (it.state === "current" && blinkOn);
        ctx.fillStyle = it.state === "passed" ? "#c3c6ca" : lit ? "#e53935" : "#5b1414";
        ctx.fill();
        if (it.state === "current") {
          ctx.lineWidth = 5;
          ctx.strokeStyle = "#e53935";
          ctx.beginPath();
          ctx.arc(x, y, r + 9, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      // Labels alternate above and below so neighbours never collide.
      ctx.fillStyle = it.state === "passed" ? "#9aa0a6" : it.state === "current" ? "#b71c1c" : "#1f2933";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const label = it.name.toUpperCase();
      fitFont(ctx, label, it.state === "current" ? 800 : 600, f.sans, 24, 13, Math.min(220, ((MAP_W - 2 * pad) / Math.max(1, n - 1)) * 1.9));
      ctx.fillText(label, x, i % 2 ? y + 48 : y - 44);
    });
  }
  tex.needsUpdate = true;
}

/**
 * Crash-barrier chevrons, as painted on Chennai flyover parapets: black
 * chevrons on white, one per 1.2 m (the barrier geometry maps u along the
 * road in 1.2 m repeats, v from the deck to the barrier top).
 */
export function makeChevronTexture(): Texture {
  const W = 128;
  const H = 128;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#e9e7e1";
  ctx.fillRect(0, 0, W, H);
  // A ">" across the face: the band runs from bottom-left up to the middle, then back down.
  ctx.fillStyle = "#1b1c1e";
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(W * 0.45, 0);
  ctx.lineTo(W * 0.95, H / 2);
  ctx.lineTo(W * 0.45, H);
  ctx.lineTo(0, H);
  ctx.lineTo(W * 0.5, H / 2);
  ctx.closePath();
  ctx.fill();
  // Weathering: a grey band at the foot.
  ctx.fillStyle = "rgba(90,88,84,0.35)";
  ctx.fillRect(0, H - 10, W, 10);
  const tex = new CanvasTexture(c);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * Footbridge roof cladding: white panels in a diamond lattice with grey
 * seams (Poonamallee Bypass FOB). One 2 m x 2 m repeat.
 */
export function makeDiamondPanelTexture(): Texture {
  const S = 128;
  const c = document.createElement("canvas");
  c.width = S;
  c.height = S;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#f1f2f0";
  ctx.fillRect(0, 0, S, S);
  ctx.strokeStyle = "#9aa0a4";
  ctx.lineWidth = 3;
  // Diamonds: two families of diagonals, plus a faint shade on alternate facets.
  for (let k = -S; k <= 2 * S; k += S / 2) {
    ctx.beginPath();
    ctx.moveTo(k, 0);
    ctx.lineTo(k + S, S);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(k, S);
    ctx.lineTo(k + S, 0);
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(120,128,134,0.12)";
  ctx.beginPath();
  ctx.moveTo(S / 2, 0);
  ctx.lineTo(S * 0.75, S / 4);
  ctx.lineTo(S / 2, S / 2);
  ctx.lineTo(S / 4, S / 4);
  ctx.closePath();
  ctx.fill();
  const tex = new CanvasTexture(c);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
