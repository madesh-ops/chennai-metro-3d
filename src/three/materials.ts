import { MeshStandardMaterial, type MeshStandardMaterialParameters } from "three";
import type { SceneEnv } from "./env.ts";

const HASH_GLSL = /* glsl */ `
float cmHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
`;

/**
 * Building material: one instanced box per building, facade drawn in the
 * shader. Window bays, floors, ground-floor shopfronts with sign bands, roof
 * tone and randomly lit windows at night all come from the instance's scale
 * and a per-instance seed, so 10 000 buildings cost a handful of draw calls.
 *
 * Per-instance attributes: aSeed (0..1), aKind (0 residential, 1 commercial
 * with shopfront, 2 glass office).
 */
export function createBuildingMaterial(env: SceneEnv): MeshStandardMaterial {
  const mat = new MeshStandardMaterial({ roughness: 0.88, metalness: 0.0 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = env.uniforms.uNight;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        attribute float aSeed;
        attribute float aKind;
        varying vec3 vFacade;
        varying vec3 vObjNormal;
        varying vec3 vScale;
        varying float vSeed;
        varying float vKind;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vec3 cmScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        vScale = cmScale;
        vFacade = vec3((position.x + 0.5) * cmScale.x, position.y * cmScale.y, (position.z + 0.5) * cmScale.z);
        vObjNormal = normal;
        vSeed = aSeed;
        vKind = aKind;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform float uNight;
        varying vec3 vFacade;
        varying vec3 vObjNormal;
        varying vec3 vScale;
        varying float vSeed;
        varying float vKind;
        ${HASH_GLSL}`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        vec3 cmN = normalize(vObjNormal);
        // The sine hash amplifies input error ~10^7×, so every input is an exact integer:
        // interpolated varyings carry tiny errors that would otherwise flicker per pixel.
        float cmSeed = floor(vSeed * 997.0 + 0.5);
        float cmRoof = step(0.5, cmN.y);
        float cmBottom = step(cmN.y, -0.5);
        float cmAlong = abs(cmN.x) > 0.5 ? vFacade.z : vFacade.x;
        float cmFace = floor(cmN.x * 2.0 + cmN.z * 3.0 + 4.5);
        float cmFloorH = vKind > 1.5 ? 3.6 : 3.1;
        float cmBay = vKind > 1.5 ? 1.6 : mix(2.4, 3.4, fract(cmSeed * 0.1371));
        vec2 cmCell = vec2(cmAlong / cmBay, vFacade.y / cmFloorH);
        vec2 cmF = fract(cmCell);
        vec2 cmId = floor(cmCell);
        float cmGround = step(vFacade.y, cmFloorH) * (1.0 - cmRoof);
        float cmTop = step(vScale.y - 0.7, vFacade.y);
        float cmEdge = step(0.6, cmAlong) * step(cmAlong, (abs(cmN.x) > 0.5 ? vScale.z : vScale.x) - 0.6);
        float cmWin;
        if (vKind > 1.5) {
          cmWin = step(0.05, cmF.x) * step(cmF.y, 0.9);
        } else {
          cmWin = step(0.2, cmF.x) * step(cmF.x, 0.8) * step(0.3, cmF.y) * step(cmF.y, 0.78);
        }
        cmWin *= (1.0 - cmRoof) * (1.0 - cmBottom) * (1.0 - cmTop) * cmEdge * (1.0 - cmGround * step(0.5, vKind));
        float cmRnd = cmHash(cmId + vec2(cmSeed, cmFace * 17.0));
        vec3 cmGlass = vKind > 1.5 ? vec3(0.30, 0.40, 0.48) : vec3(0.13, 0.16, 0.2);
        // Subtle per-bay colour variation and weathering.
        float cmWeather = 0.9 + 0.1 * cmHash(vec2(floor(cmAlong * 0.6), cmSeed + 3.0));
        vec3 cmBase = diffuseColor.rgb * cmWeather;
        cmBase = mix(cmBase, cmBase * 0.78, cmRoof);
        // Shopfront: dark opening with a coloured sign band above it.
        float cmShop = cmGround * step(0.5, vKind) * step(vKind, 1.5) * cmEdge;
        float cmSign = cmShop * step(2.35, vFacade.y) * step(vFacade.y, 3.05);
        float cmOpening = cmShop * step(vFacade.y, 2.3) * step(0.06, fract(cmAlong / 4.2)) * step(fract(cmAlong / 4.2), 0.94);
        vec3 cmSignCol = vec3(0.75, 0.16, 0.14);
        float cmSr = cmHash(vec2(floor(cmAlong / 4.2), cmSeed + 7.0));
        if (cmSr > 0.75) cmSignCol = vec3(0.12, 0.36, 0.7);
        else if (cmSr > 0.5) cmSignCol = vec3(0.9, 0.72, 0.14);
        else if (cmSr > 0.3) cmSignCol = vec3(0.13, 0.52, 0.32);
        vec3 cmCol = mix(cmBase, cmGlass, cmWin);
        cmCol = mix(cmCol, vec3(0.09, 0.09, 0.1), cmOpening);
        cmCol = mix(cmCol, cmSignCol, cmSign);
        diffuseColor.rgb = cmCol;
        float cmLit = cmWin * step(0.52, cmRnd) * uNight;
        float cmShopLit = (cmOpening * 0.6 + cmSign * 0.9) * uNight;
        vec3 cmLitCol = mix(vec3(1.0, 0.78, 0.48), vec3(0.85, 0.92, 1.0), step(0.85, cmRnd));`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += cmLitCol * cmLit * (0.9 + 0.6 * cmRnd) + mix(vec3(1.0, 0.95, 0.85), cmSignCol * 1.6, cmSign) * cmShopLit;`,
      );
  };
  mat.customProgramCacheKey = () => "cm-building-v3";
  return mat;
}

/** Standard material whose emissive intensity follows the night factor. */
export function nightEmissive(params: MeshStandardMaterialParameters, dayIntensity = 0, nightIntensity = 1) {
  const mat = new MeshStandardMaterial(params);
  mat.userData.nightEmissive = { dayIntensity, nightIntensity };
  mat.emissiveIntensity = dayIntensity;
  return mat;
}
