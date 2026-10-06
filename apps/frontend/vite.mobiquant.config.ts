import path from "path";
import { mergeConfig, type UserConfig } from "vite";
import shared from "./vite.config";

const { build, ...common } = shared as UserConfig;

export default mergeConfig(common, {
  base: "/",
  publicDir: false,
  build: {
    ...build,
    outDir: "../../dist-mobiquant",
    sourcemap: false,
    rollupOptions: { input: { mobiquant: path.resolve(__dirname, "mobiquant.html") } },
  },
});
