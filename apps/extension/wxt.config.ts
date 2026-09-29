import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";

// https://wxt.dev/api/config.html
export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  // Explicit imports everywhere (`wxt/browser`, `wxt/utils/*`, react) so tsc and vitest see the
  // same code. No auto-import globals.
  imports: false,
  manifest: {
    name: "Kavannah",
    description:
      "Analyze potentially antisemitic or misleading posts on X and decide what constructive action to take.",
    permissions: ["storage", "activeTab", "tabs"],
    host_permissions: ["http://127.0.0.1/*", "http://localhost/*", "https://x.com/*", "https://twitter.com/*"],
    action: { default_title: "Kavannah" },
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
