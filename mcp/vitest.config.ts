import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Tests run against the library sources, so no build step is required.
      "taiga-api-client": fileURLToPath(new URL("../src/index.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/*.test.ts"],
    globals: false,
    clearMocks: true,
  },
});
