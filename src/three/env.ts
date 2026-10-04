import { Color, Vector3 } from "three";

/**
 * Per-scene environment state shared by every material that reacts to
 * time of day or weather. Values are blended every frame by <Lighting/> so
 * day ↔ night and weather changes fade instead of snapping.
 */
export interface SceneEnv {
  /** 0 = day, 1 = night (animated) */
  night: number;
  /** 0 = clear, 1 = overcast (animated) */
  cloud: number;
  /** 0 = dry, 1 = raining (animated) */
  rain: number;
  targets: { night: number; cloud: number; rain: number };
  uniforms: {
    uNight: { value: number };
    uTime: { value: number };
    uRain: { value: number };
  };
  sunDirection: Vector3;
  fogColor: Color;
}

export function createSceneEnv(night = 0): SceneEnv {
  return {
    night,
    cloud: 0,
    rain: 0,
    targets: { night, cloud: 0, rain: 0 },
    uniforms: {
      uNight: { value: night },
      uTime: { value: 0 },
      uRain: { value: 0 },
    },
    // Afternoon sun from the west-south-west at ~50° elevation.
    sunDirection: new Vector3(-0.557, 0.766, 0.321).normalize(),
    fogColor: new Color(),
  };
}
