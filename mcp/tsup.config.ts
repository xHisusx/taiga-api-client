import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  dts: false,
  clean: true,
  sourcemap: true,
  target: "node18",
  // The CLI is an executable, not a library. `taiga-api-client` is resolved through the
  // tsconfig path to this repository's own sources and bundled in, so a local build always
  // runs the client in the working tree rather than whatever version npm happens to hold.
  // The MCP SDK and zod stay external: they are large and must not be duplicated.
  noExternal: ["taiga-api-client"],
  external: ["@modelcontextprotocol/sdk", "zod"],
  banner: { js: "#!/usr/bin/env node" },
});
