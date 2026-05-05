import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { pinterestApiPlugin } from "./vite-plugin-pinterest-api.js";

export default defineConfig({
  plugins: [vue(), pinterestApiPlugin()],
});
