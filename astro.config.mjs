import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import { defineConfig } from "astro/config";

export default defineConfig({
  output: "server",
  session: {
    driver: "memory"
  },
  adapter: cloudflare({
    imageService: "passthrough"
  }),
  integrations: [react()]
});
