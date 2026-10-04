"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  BackSide,
  Color,
  type DirectionalLight,
  Fog,
  type HemisphereLight,
  Mesh,
  Object3D,
  type PerspectiveCamera,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from "three";
import { useScene } from "./SceneContext.tsx";
import { snapShadowCentre } from "./shadowSnap.ts";
import { damp, lerp } from "../utils/interpolation.ts";
import type { TimeOfDay, Weather } from "../simulation/store.ts";

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uNight;
uniform float uCloud;
uniform float uTime;
varying vec3 vDir;

float h21(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0; float a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * vnoise(p); p *= 2.03; a *= 0.5; }
  return v;
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), 0.5));
  col = mix(col, uGround, smoothstep(0.0, -0.06, h));

  float sd = max(dot(d, uSunDir), 0.0);
  float clear = 1.0 - uCloud * 0.85;
  col += uSunColor * (pow(sd, 900.0) * 8.0 + pow(sd, 18.0) * 0.22) * clear * (1.0 - uNight * 0.7);

  // Clouds projected onto a plane overhead.
  if (h > 0.0) {
    vec2 cp = d.xz / (h + 0.12) * 1.6 + vec2(uTime * 0.004, uTime * 0.002);
    float n = fbm(cp);
    float cover = mix(0.62, 0.30, uCloud);
    float c = smoothstep(cover, cover + 0.28, n) * smoothstep(0.0, 0.25, h);
    vec3 cloudCol = mix(vec3(1.0), uHorizon * 1.05, 0.35 + uCloud * 0.4);
    cloudCol = mix(cloudCol, vec3(0.08, 0.1, 0.14), uNight * 0.92);
    col = mix(col, cloudCol, c * (0.55 + uCloud * 0.4));
  }

  // Stars on clear nights.
  if (uNight > 0.01 && h > 0.0) {
    vec2 sp = vec2(atan(d.z, d.x), asin(h)) * 260.0;
    vec2 cell = floor(sp);
    float r = h21(cell);
    float star = step(0.9965, r) * smoothstep(0.5, 0.0, length(fract(sp) - 0.5));
    col += vec3(0.85, 0.9, 1.0) * star * uNight * (1.0 - uCloud) * smoothstep(0.05, 0.3, h);
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const PALETTE = {
  dayTop: new Color("#3f7fc0"),
  dayHorizon: new Color("#d6e2e6"),
  cloudTop: new Color("#8995a2"),
  cloudHorizon: new Color("#c4cacd"),
  rainTop: new Color("#5f6b77"),
  rainHorizon: new Color("#9aa3aa"),
  nightTop: new Color("#04070e"),
  nightHorizon: new Color("#1b2333"),
  dayGround: new Color("#9b9585"),
  nightGround: new Color("#0b0d10"),
  sunDay: new Color("#fff1dc"),
  moon: new Color("#9db3ff"),
  hemiSkyDay: new Color("#d3e6ff"),
  hemiGroundDay: new Color("#8f8370"),
  hemiSkyNight: new Color("#1e2c45"),
  hemiGroundNight: new Color("#16130f"),
};

export interface LightingProps {
  timeOfDay: TimeOfDay;
  weather: Weather;
  shadows: boolean;
  shadowMapSize: number;
  mapMode: boolean;
  instant?: boolean;
  /** Landing-page look: low warm sun, blue-hour sky, windows starting to light. */
  dusk?: boolean;
}

/** Width of the area the sun's shadow map covers (metres). */
const SHADOW_EXTENT = 150;

const DUSK_SUN = new Vector3(-0.93, 0.16, 0.33).normalize();
const DUSK_COLOR = new Color("#ffb47a");

export function Lighting({ timeOfDay, weather, shadows, shadowMapSize, mapMode, instant = false, dusk = false }: LightingProps) {
  const { env, pose } = useScene();
  const { scene, camera } = useThree();
  const sun = useRef<DirectionalLight>(null);
  const hemi = useRef<HemisphereLight>(null);
  const target = useMemo(() => new Object3D(), []);
  const first = useRef(true);

  const sky = useMemo(() => {
    const mat = new ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTop: { value: new Color() },
        uHorizon: { value: new Color() },
        uGround: { value: new Color() },
        uSunDir: { value: env.sunDirection.clone() },
        uSunColor: { value: new Color("#fff3df") },
        uNight: env.uniforms.uNight,
        uCloud: { value: 0 },
        uTime: env.uniforms.uTime,
      },
    });
    const mesh = new Mesh(new SphereGeometry(1, 32, 16), mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = -10;
    return mesh;
  }, [env]);

  useEffect(() => {
    scene.fog = new Fog("#cfdde4", 300, 4000);
    scene.add(target);
    return () => {
      scene.fog = null;
      scene.remove(target);
      sky.geometry.dispose();
      (sky.material as ShaderMaterial).dispose();
    };
  }, [scene, target, sky]);

  const tmp = useMemo(
    () => ({ top: new Color(), horizon: new Color(), a: new Color(), b: new Color(), moonDir: new Vector3(0.3, 0.8, -0.5).normalize(), centre: new Vector3() }),
    [],
  );

  useFrame((_, delta) => {
    env.targets.night = dusk ? 0.46 : timeOfDay === "night" ? 1 : 0;
    env.targets.cloud = weather === "clear" ? 0 : 1;
    env.targets.rain = weather === "rain" ? 1 : 0;
    const k = instant || first.current ? 1e6 : 1.1;
    first.current = false;
    env.night = damp(env.night, env.targets.night, k, delta);
    env.cloud = damp(env.cloud, env.targets.cloud, k, delta);
    env.rain = damp(env.rain, env.targets.rain, k, delta);
    env.uniforms.uNight.value = env.night;
    env.uniforms.uRain.value = env.rain;
    env.uniforms.uTime.value += delta;

    const n = env.night;
    const c = env.cloud;
    const r = env.rain;
    // Sky colours: day → overcast → rain, then towards night.
    tmp.top.copy(PALETTE.dayTop).lerp(PALETTE.cloudTop, c).lerp(PALETTE.rainTop, r);
    tmp.horizon.copy(PALETTE.dayHorizon).lerp(PALETTE.cloudHorizon, c).lerp(PALETTE.rainHorizon, r);
    tmp.top.lerp(PALETTE.nightTop, n);
    tmp.horizon.lerp(PALETTE.nightHorizon, n);
    const u = (sky.material as ShaderMaterial).uniforms;
    u.uTop.value.copy(tmp.top);
    u.uHorizon.value.copy(tmp.horizon);
    u.uGround.value.copy(PALETTE.dayGround).lerp(PALETTE.nightGround, n);
    u.uCloud.value = c;
    if (dusk) {
      u.uSunDir.value.copy(DUSK_SUN);
      u.uSunColor.value.copy(DUSK_COLOR);
      u.uHorizon.value.lerp(DUSK_COLOR, 0.28);
    }

    const fog = scene.fog as Fog;
    env.fogColor.copy(u.uHorizon.value);
    fog.color.copy(u.uHorizon.value);
    if (mapMode) {
      fog.near = 30000;
      fog.far = 120000;
    } else {
      fog.near = lerp(lerp(320, 190, c), 70, r);
      fog.far = lerp(lerp(lerp(4200, 2600, c), 1100, r), lerp(3000, 1800, c), n * 0.5);
    }

    const cam = camera as PerspectiveCamera;
    sky.position.copy(cam.position);
    sky.scale.setScalar(cam.far * 0.92);

    if (sun.current) {
      const s = sun.current;
      const dayI = lerp(3.1, 0.75, c) * (1 - r * 0.25);
      s.intensity = lerp(dayI, 0.22, n);
      s.color.copy(PALETTE.sunDay).lerp(PALETTE.moon, n);
      if (dusk) {
        s.intensity = 2.4;
        s.color.copy(DUSK_COLOR);
      }
      const dir = dusk ? DUSK_SUN : n > 0.5 ? tmp.moonDir : env.sunDirection;
      // Follow the train, but only in whole shadow texels so shadows don't shimmer.
      snapShadowCentre(pose.center, dir, SHADOW_EXTENT / shadowMapSize, tmp.centre);
      s.position.copy(tmp.centre).addScaledVector(dir, 260);
      target.position.copy(tmp.centre);
      s.target = target;
      s.castShadow = shadows && c < 0.8 && !mapMode;
    }
    if (hemi.current) {
      const h = hemi.current;
      h.intensity = lerp(lerp(1.05, 1.35, c), 0.32, n);
      h.color.copy(PALETTE.hemiSkyDay).lerp(PALETTE.hemiSkyNight, n);
      h.groundColor.copy(PALETTE.hemiGroundDay).lerp(PALETTE.hemiGroundNight, n);
    }
  });

  return (
    <>
      <primitive object={sky} />
      <hemisphereLight ref={hemi} args={["#d3e6ff", "#8f8370", 1.1]} />
      <directionalLight
        ref={sun}
        intensity={3}
        castShadow={shadows}
        shadow-mapSize-width={shadowMapSize}
        shadow-mapSize-height={shadowMapSize}
        shadow-camera-left={-SHADOW_EXTENT / 2}
        shadow-camera-right={SHADOW_EXTENT / 2}
        shadow-camera-top={SHADOW_EXTENT / 2}
        shadow-camera-bottom={-SHADOW_EXTENT / 2}
        shadow-camera-near={20}
        shadow-camera-far={600}
        shadow-bias={-0.0004}
        shadow-normalBias={0.05}
      />
    </>
  );
}
