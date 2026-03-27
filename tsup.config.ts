import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  outDir: "dist",
  bundle: true,
  splitting: false,
  sourcemap: true,
  dts: true,
  clean: true,
  // Only @openacp/cli is external (peer dep, resolved from host)
  // Everything else (zod, nanoid, local files) gets bundled inline
  external: ["@openacp/cli"],
  noExternal: [/.*/],
  esbuildOptions(options) {
    options.resolveExtensions = [".ts", ".js", ".mjs"];
  },
});
