"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import { BoxGeometry, type BufferGeometry, Color, Matrix4, MeshStandardMaterial, PlaneGeometry, type Texture } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { useScene } from "./SceneContext.tsx";
import { ensureFontsLoaded, makeConcreteTexture, makeFlyoverTexture, makeNameBoardTexture } from "./textures.ts";
import { composeMatrix, rectProfile, sweepProfile, type ProfilePoint } from "../utils/geometry.ts";
import { smoothstep } from "../utils/interpolation.ts";
import type { FlyoverModel } from "../simulation/RouteController.ts";

const BARRIER_H = 0.9;
const BARRIER_W = 0.5;
const PIER_SPACING = 25;

/** Deck cross-section at height h: box girder when high, closing down to a solid ramp near the ground. */
function deckProfile(half: number, h: number): ProfilePoint[] {
  const t = smoothstep(2.2, 1.0, h);
  const bottom = Math.max(-1.2, -h);
  const edge = -0.45 + (-h + 0.45) * t;
  const girder = 3.5 + (half - 3.5) * t;
  const inner = half - BARRIER_W;
  return [
    { l: -girder, y: bottom },
    { l: girder, y: bottom },
    { l: half, y: Math.max(edge, bottom) },
    { l: half, y: BARRIER_H },
    { l: inner, y: BARRIER_H },
    { l: inner, y: -0.03 },
    { l: -inner, y: -0.03 },
    { l: -inner, y: BARRIER_H },
    { l: -half, y: BARRIER_H },
    { l: -half, y: Math.max(edge, bottom) },
  ];
}

interface Built {
  f: FlyoverModel;
  surface: BufferGeometry;
  body: BufferGeometry;
  piers: BufferGeometry | null;
  boards: { matrix: Matrix4; geometry: BufferGeometry }[];
}

function NameBoards({ built }: { built: Built }) {
  const { env } = useScene();
  const raw = built.f.raw;
  const [texture, setTexture] = useState<Texture | null>(null);
  useEffect(() => {
    let alive = true;
    let tex: Texture | null = null;
    void ensureFontsLoaded().then(() => {
      if (!alive) return;
      tex = makeNameBoardTexture(raw.name, raw.nameTa ?? null, "civic");
      setTexture(tex);
    });
    return () => {
      alive = false;
      tex?.dispose();
    };
  }, [raw]);
  const material = useMemo(
    () => (texture ? new MeshStandardMaterial({ map: texture, emissiveMap: texture, emissive: new Color("#ffffff"), emissiveIntensity: 0, roughness: 0.6 }) : null),
    [texture],
  );
  useFrame(() => {
    if (material) material.emissiveIntensity = 0.1 + env.night * 0.7;
  });
  useEffect(() => () => material?.dispose(), [material]);
  if (!material) return null;
  return (
    <>
      {built.boards.map((b, i) => (
        <mesh key={i} geometry={b.geometry} material={material} matrix={b.matrix} matrixAutoUpdate={false} />
      ))}
    </>
  );
}

/**
 * Road flyovers on side roads: the MGR flyover on Mount–Poonamallee Road,
 * which runs under the metro west of Porur Junction, crests over the
 * junction and carries on east-south-east while the metro turns up Arcot
 * Road. Four lanes on a box-girder deck with crash barriers, blade piers,
 * solid ramp ends and name boards. Heights come from route.flyovers.
 */
export function Flyover() {
  const { route, range } = useScene();

  const built = useMemo<Built[]>(() => {
    return route.flyovers
      .filter((f) => f.corridorTo > range[0] - 300 && f.corridorFrom < range[1] + 300)
      .map((f) => {
        const half = f.halfWidth;
        const road = f.road.alignment;
        const surface = sweepProfile(
          road,
          f.startS,
          f.endS,
          3,
          [
            { l: half - BARRIER_W, y: 0.02 },
            { l: -(half - BARRIER_W), y: 0.02 },
          ],
          { heightAt: f.heightAt, uPerMetre: 1 / 12, vPerMetre: 1 / (2 * (half - BARRIER_W)) },
        );
        const body = mergeGeometries([
          sweepProfile(road, f.startS, f.endS, 3, deckProfile(half, f.crest), {
            heightAt: f.heightAt,
            profileAt: (s) => deckProfile(half, f.heightAt(s)),
            closed: true,
            uPerMetre: 1 / 8,
            vPerMetre: 1 / 4,
          }),
          // Median crash barrier.
          sweepProfile(road, f.startS + 4, f.endS - 4, 3, rectProfile(-0.3, 0.3, 0, 0.8), {
            heightAt: f.heightAt,
            closed: true,
            uPerMetre: 1 / 8,
            vPerMetre: 1 / 4,
          }),
        ])!;

        // Blade piers in the median wherever the deck is clear of the ground.
        const piers: BufferGeometry[] = [];
        const m = new Matrix4();
        const p = { x: 0, z: 0 };
        for (let s = f.startS + PIER_SPACING / 2; s < f.endS; s += PIER_SPACING) {
          const h = f.heightAt(s);
          if (h < 2.2) continue;
          const g = new BoxGeometry(1.2, h - 1.2, 6.0);
          g.translate(0, (h - 1.2) / 2, 0);
          road.point(s, p);
          g.applyMatrix4(composeMatrix(m, p.x, 0, p.z, road.heading(s)));
          piers.push(g.toNonIndexed());
        }

        // Name boards on the outer parapets near each end, facing the street.
        const boards: { geometry: BufferGeometry; matrix: Matrix4 }[] = [];
        for (const s of [f.startS + 70, f.endS - 70]) {
          const h = f.heightAt(s);
          for (const side of [-1, 1]) {
            const geometry = new PlaneGeometry(10, 2.5);
            if (side < 0) geometry.rotateY(Math.PI);
            geometry.translate(0, h + BARRIER_H + 1.5, 0);
            const at = road.offsetPoint(s, side * (half + 0.05));
            boards.push({ geometry, matrix: composeMatrix(new Matrix4(), at.x, 0, at.z, road.heading(s)) });
          }
        }

        return { f, surface, body, piers: piers.length ? mergeGeometries(piers)! : null, boards };
      });
  }, [route.flyovers, range]);

  const materials = useMemo(() => {
    const concrete = makeConcreteTexture();
    return {
      // Pulled slightly forward so the low ramp ends never fight the road beneath.
      surface: new MeshStandardMaterial({ map: makeFlyoverTexture(), roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8 }),
      body: new MeshStandardMaterial({ color: "#cfccc4", map: concrete, roughness: 0.92 }),
      pier: new MeshStandardMaterial({ color: "#c8c5bd", map: concrete, roughness: 0.92 }),
    };
  }, []);

  useEffect(
    () => () => {
      for (const b of built) {
        b.surface.dispose();
        b.body.dispose();
        b.piers?.dispose();
        b.boards.forEach((x) => x.geometry.dispose());
      }
    },
    [built],
  );
  useEffect(() => () => Object.values(materials).forEach((m) => m.dispose()), [materials]);

  // Dev-only: flyover position for scripted camera framing.
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const w = window as unknown as { __cm3dFlyover?: () => unknown };
    w.__cm3dFlyover = () =>
      route.flyovers.map((f) => {
        const road = f.road.alignment;
        // Road points every 25 m along the flyover and 100 m beyond, with their right-hand vector.
        const samples = [];
        for (let s = f.startS - 100; s <= f.endS + 100; s += 25) {
          const p = road.point(s);
          const r = road.right(s);
          samples.push({ at: Math.round(s - f.road.junctionS), x: p.x, z: p.z, rx: r.x, rz: r.z, h: f.heightAt(s) });
        }
        const j = road.point(f.road.junctionS);
        return { id: f.raw.id, x: j.x, z: j.z, crest: f.crest, samples };
      });
    return () => {
      delete w.__cm3dFlyover;
    };
  }, [route.flyovers]);

  return (
    <group>
      {built.map((b) => (
        <group key={b.f.raw.id}>
          {/* The deck itself comes from OpenStreetMap (world tiles: both carriageways, real
              path and ramps); only the curated name boards are drawn here. */}
          <NameBoards built={b} />
        </group>
      ))}
    </group>
  );
}
