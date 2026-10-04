"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { type BufferGeometry, type CanvasTexture, type Group, MeshBasicMaterial, PlaneGeometry } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { useScene } from "./SceneContext.tsx";
import { TRAIN } from "./layout.ts";
import { drawLedText, drawRouteMap, ensureFontsLoaded, makeLedTextTexture, makeRouteMapTexture, type RouteMapItem } from "./textures.ts";
import { arrivalPhase } from "../simulation/StationController.ts";
import type { SimulationEngine } from "../simulation/SimulationEngine.ts";

/**
 * Passenger information inside every car, as on CMRL trains: amber LED text
 * strips over the doors and at the car ends (cycling English and Tamil), and
 * a route-map strip above the windows whose LEDs track the journey.
 * Geometry is in car-local space (see trainModel.ts: +x front, +y up from
 * rail top, +z right) and follows pose.cars like the car bodies do.
 */

const HALF = TRAIN.carLength / 2;
const PANEL_IN = TRAIN.width / 2 - 0.07;
const CAB = 2.3;
/** Door centres per car kind (trainModel.ts). */
const DOORS = {
  DMC: [-8.6, -3.2, 2.2, 7.3],
  TC: [-8.55, -2.85, 2.85, 8.55],
};
const CYCLE_S = 3;

type Kind = keyof typeof DOORS;

function wallPlane(w: number, h: number, x: number, y: number, side: 1 | -1, inset: number) {
  const g = new PlaneGeometry(w, h);
  // Planes face +z; the right-hand wall (+z) must face inwards (-z).
  if (side > 0) g.rotateY(Math.PI);
  g.translate(x, y, side * (PANEL_IN - inset));
  return g;
}

function endPlane(w: number, h: number, x: number, y: number, facing: 1 | -1) {
  const g = new PlaneGeometry(w, h);
  g.rotateY(facing > 0 ? Math.PI / 2 : -Math.PI / 2);
  g.translate(x, y, 0);
  return g;
}

/** LED text strips (all share one texture) and route-map strips for one car kind. */
function cabinGeometry(kind: Kind): { text: BufferGeometry; map: BufferGeometry } {
  const doors = DOORS[kind];
  const text: BufferGeometry[] = [];
  const map: BufferGeometry[] = [];
  for (const side of [-1, 1] as const) {
    // Over every door, just under the ceiling.
    for (const dx of doors) text.push(wallPlane(1.2, 0.19, dx, 3.0, side, 0.1));
    // Route map above the windows between the two middle doors.
    const a = doors[1] + 0.85;
    const b = doors[2] - 0.85;
    map.push(wallPlane(b - a, 0.27, (a + b) / 2, 2.98, side, 0.06));
  }
  // Car ends, facing down the car.
  const front = kind === "DMC" ? HALF - CAB : HALF;
  text.push(endPlane(1.5, 0.24, front - 0.1, 2.85, -1));
  text.push(endPlane(1.5, 0.24, -HALF + 0.1, 2.85, 1));
  return { text: mergeGeometries(text)!, map: mergeGeometries(map)! };
}

/** The lines the LED strips cycle through right now. */
function ledLines(engine: SimulationEngine): string[] {
  const s = engine.sample;
  const { stops } = engine.journey;
  const ta = (i: number) => {
    const st = stops[i]?.station;
    return st ? (st.nameTa ?? st.name) : "";
  };
  const en = (i: number) => stops[i]?.station.name.toUpperCase() ?? "";
  const last = stops.length - 1;
  const phase = engine.started ? arrivalPhase(s, engine.trajectory.stops) : "none";
  const atStation = s.state === "stopped" || s.state === "doors-open" || s.state === "doors-closing" || s.state === "idle";
  if (atStation && s.stopIndex === last && engine.started) {
    return ["THIS TRAIN TERMINATES HERE", "இந்த ரயில் இங்கே முடிவடைகிறது", "PLEASE ALIGHT", "அனைவரும் இறங்கவும்"];
  }
  if (phase === "approaching") {
    const i = s.stopIndex + 1;
    return [`NEXT STATION: ${en(i)}`, `அடுத்த நிலையம்: ${ta(i)}`, "DOORS OPEN ON THE LEFT", "கதவுகள் இடது பக்கம் திறக்கும்"];
  }
  if (atStation) {
    const i = s.stopIndex;
    const lines = [en(i), `இது ${ta(i)} நிலையம்`];
    if (phase === "doors-closing") lines.push("PLEASE STAND CLEAR OF THE DOORS");
    lines.push(`TOWARDS ${en(last)}`);
    return lines;
  }
  return ["WELCOME ABOARD CHENNAI METRO", "சென்னை மெட்ரோவுக்கு வரவேற்கிறோம்", `NEXT STATION: ${en(s.stopIndex + 1)}`, `TOWARDS ${en(last)}`];
}

function routeItems(engine: SimulationEngine): RouteMapItem[] {
  const s = engine.sample;
  const seq = engine.journey.sequence;
  const atStation = s.state === "stopped" || s.state === "doors-open" || s.state === "doors-closing" || s.state === "idle";
  // The highlighted station: where we stand, or the next served stop.
  const target = atStation ? engine.journey.stops[s.stopIndex] : engine.journey.stops[Math.min(s.stopIndex + 1, engine.journey.stops.length - 1)];
  const targetId = target?.station.id;
  const targetIdx = seq.findIndex((q) => q.station.id === targetId);
  return seq.map((q, i) => ({
    name: q.station.name,
    kind: q.kind,
    state: i === targetIdx ? "current" : i < targetIdx ? "passed" : "ahead",
  }));
}

export function CabinDisplays({ engine }: { engine: SimulationEngine }) {
  const { pose, route } = useScene();
  const geos = useMemo(() => ({ DMC: cabinGeometry("DMC"), TC: cabinGeometry("TC") }), []);
  const [tex, setTex] = useState<{ text: CanvasTexture; map: CanvasTexture } | null>(null);
  const groups = useRef<(Group | null)[]>([]);
  const state = useRef({ text: "", mapKey: "", clock: 0, mapClock: 0 });

  // Textures are drawn once fonts (incl. Tamil) are ready.
  useEffect(() => {
    let alive = true;
    let made: { text: CanvasTexture; map: CanvasTexture } | null = null;
    void ensureFontsLoaded().then(() => {
      if (!alive) return;
      made = { text: makeLedTextTexture(), map: makeRouteMapTexture() };
      setTex(made);
    });
    return () => {
      alive = false;
      made?.text.dispose();
      made?.map.dispose();
    };
  }, []);

  const mats = useMemo(
    () => (tex ? { text: new MeshBasicMaterial({ map: tex.text, toneMapped: false }), map: new MeshBasicMaterial({ map: tex.map, toneMapped: false }) } : null),
    [tex],
  );
  useEffect(() => () => {
    mats?.text.dispose();
    mats?.map.dispose();
  }, [mats]);
  useEffect(
    () => () => {
      for (const g of Object.values(geos)) {
        g.text.dispose();
        g.map.dispose();
      }
    },
    [geos],
  );

  useFrame((_, delta) => {
    pose.cars.forEach((car, i) => {
      const g = groups.current[i];
      if (!g) return;
      g.position.copy(car.position);
      g.quaternion.copy(car.quaternion);
    });
    if (!tex) return;
    const st = state.current;
    st.clock += Math.min(delta, 0.1);
    st.mapClock += Math.min(delta, 0.1);
    // LED text: cycle lines, redraw only when the text changes.
    const lines = ledLines(engine);
    const line = lines[Math.floor(st.clock / CYCLE_S) % lines.length] ?? "";
    if (line !== st.text) {
      st.text = line;
      drawLedText(tex.text, line);
    }
    // Route map at about 4 Hz (blinking current station).
    if (st.mapClock >= 0.25) {
      st.mapClock = 0;
      const items = routeItems(engine);
      const blink = Math.floor(st.clock * 2) % 2 === 0;
      const key = items.map((it) => it.state[0]).join("") + (blink ? "1" : "0");
      if (key !== st.mapKey) {
        st.mapKey = key;
        drawRouteMap(tex.map, items, blink, route.line.colour);
      }
    }
  });

  if (!mats) return null;
  const kinds: Kind[] = ["DMC", "TC", "DMC"];
  return (
    <group>
      {kinds.map((k, i) => (
        <group
          key={i}
          ref={(g) => {
            groups.current[i] = g;
          }}
        >
          <mesh geometry={geos[k].text} material={mats.text} />
          <mesh geometry={geos[k].map} material={mats.map} />
        </group>
      ))}
    </group>
  );
}
