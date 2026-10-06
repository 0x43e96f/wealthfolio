import { defineConfig } from "vitest/config";
import shared from "./vite.mobiquant.config";

export default defineConfig({
  ...shared,
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: "./src/mobiquant/test-setup.ts",
    include: ["src/mobiquant/**/*.test.{ts,tsx}"],
  },
});
