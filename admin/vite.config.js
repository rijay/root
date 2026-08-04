import { fileURLToPath, URL } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
  base: "/admin/",
  plugins: [vue()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/health": "http://127.0.0.1:8787",
    },
  },
  build: {
    cssCodeSplit: false,
    manifest: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("/node_modules/element-plus/")
            || id.includes("/node_modules/@element-plus/icons-vue/")
            || id.includes("/node_modules/@vueuse/")) return "element";
          if (id.includes("/node_modules/vue/") || id.includes("/node_modules/@vue/")) return "vue";
          return undefined;
        },
      },
    },
  },
});
