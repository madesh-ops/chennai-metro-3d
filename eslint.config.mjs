import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // R3F JSX props (position, args, attach…) are not DOM attributes.
      "react/no-unknown-property": "off",
    },
  },
  {
    // The 3D layer mutates three.js objects (materials, uniforms, matrices)
    // inside useFrame by design — that is how R3F avoids React re-renders on
    // every frame. The React Compiler immutability rule doesn't model this.
    files: ["src/three/**/*.{ts,tsx}"],
    rules: {
      "react-hooks/immutability": "off",
    },
  },
  globalIgnores([".next/**", "out/**", "node_modules/**", "next-env.d.ts", "scripts/**"]),
]);
