import { defineConfig } from "astro/config";
import tailwind from "@astrojs/tailwind";

// Deploys to https://litopys-dev.github.io/litopys/
export default defineConfig({
  site: "https://litopys-dev.github.io",
  base: "/litopys",
  trailingSlash: "ignore",
  integrations: [tailwind({ applyBaseStyles: true })],
});
