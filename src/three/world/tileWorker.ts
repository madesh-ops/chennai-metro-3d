/// <reference lib="webworker" />
/**
 * Tile worker: fetch, decompress, decode and build world tiles off the main
 * thread (a dense tile takes 25–70 ms to build, which would drop frames).
 * Replies with plain typed arrays, transferred without copying; WorldTiles
 * only wraps them in BufferGeometry.
 */
import { Color } from "three";
import { decodeTile } from "./tileFormat.ts";
import { packedBuffers, packTile, type BuildOptions } from "./worldGeometry.ts";
import { makeKeepOut, type KeepOutData } from "./keepOutCore.ts";

export type WorkerRequest =
  | { type: "init"; gen: number; base: string; palette: string[]; keep: KeepOutData; signCells: number; treeDensity: number }
  | { type: "tile"; gen: number; key: string };

export type WorkerReply = { gen: number; key: string; tile?: import("./worldGeometry.ts").PackedTile; error?: string };

let gen = -1;
let base = "";
let opts: BuildOptions | null = null;

async function load(key: string): Promise<ArrayBuffer> {
  const res = await fetch(`${base}/world/tiles/${key}.bin`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  let buf = await res.arrayBuffer();
  const head = new Uint8Array(buf, 0, 2);
  // Stored gzip-compressed; a server may already have undone that in transit.
  if (head[0] === 0x1f && head[1] === 0x8b) {
    const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
    buf = await new Response(stream).arrayBuffer();
  }
  return buf;
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  if (msg.type === "init") {
    gen = msg.gen;
    base = msg.base;
    opts = { palette: msg.palette.map((c) => new Color(c)), keep: makeKeepOut(msg.keep), signCells: msg.signCells, treeDensity: msg.treeDensity };
    return;
  }
  const g = msg.gen;
  try {
    const buf = await load(msg.key);
    // Superseded while downloading (route or quality changed): drop it.
    if (g !== gen || !opts) return;
    const tile = packTile(msg.key, decodeTile(buf), opts);
    (self as unknown as Worker).postMessage({ gen: g, key: msg.key, tile } satisfies WorkerReply, packedBuffers(tile));
  } catch (err) {
    (self as unknown as Worker).postMessage({ gen: g, key: msg.key, error: err instanceof Error ? err.message : String(err) } satisfies WorkerReply);
  }
};
