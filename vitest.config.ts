import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
  // tsconfig keeps JSX as "preserve" for Next.js; tests need it compiled.
  esbuild: { jsx: "automatic" },
  test: {
    include: ["lib/__tests__/**/*.test.{ts,tsx}"],
    environment: "node",
  },
});
