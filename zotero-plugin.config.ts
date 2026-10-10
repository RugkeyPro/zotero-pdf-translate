import { defineConfig } from "zotero-plugin-scaffold";
import pkg from "./package.json";
import { copyFileSync } from "fs";

export default defineConfig({
  source: ["src", "addon"],
  dist: "build",
  name: "Translate for Zotero Local",
  id: pkg.config.addonID,
  namespace: pkg.config.addonRef,
  updateURL:
    "https://github.com/RugkeyPro/zotero-pdf-translate/releases/latest/download/update-beta.json",
  xpiDownloadLink:
    "https://github.com/RugkeyPro/zotero-pdf-translate/releases/download/v{{version}}/{{xpiName}}.xpi",

  server: {
    asProxy: false,
  },

  test: {
    hooks: {
      // test/gptApiFormat.test.ts sends its requests to this mock server. It
      // runs in the tester's process, so it stops when the tests exit.
      "test:init": async () => {
        const { startMockLLMServer } =
          await import("./test/mock-llm-server.mjs");
        await startMockLLMServer();
      },
    },
  },

  build: {
    assets: ["addon/**/*.*"],
    define: {
      ...pkg.config,
      author: pkg.author,
      description: pkg.description,
      homepage: pkg.homepage,
      buildVersion: pkg.version,
      buildTime: "{{buildTime}}",
    },
    esbuildOptions: [
      {
        entryPoints: [
          { in: "src/index.ts", out: pkg.config.addonRef },
          { in: "src/extras/*.*", out: "" },
        ],
        define: {
          __env__: `"${process.env.NODE_ENV}"`,
        },
        bundle: true,
        target: "firefox115",
        outdir: "build/addon/chrome/content/scripts",
      },
    ],
    // If you want to checkout update.json into the repository, uncomment the following lines:
    // makeUpdateJson: {
    //   hash: false,
    // },
    // hooks: {
    //   "build:makeUpdateJSON": (ctx) => {
    //     copyFileSync("build/update.json", "update.json");
    //     copyFileSync("build/update-beta.json", "update-beta.json");
    //   },
    // },
  },
  // release: {
  //   bumpp: {
  //     execute: "npm run build",
  //   },
  // },

  // If you need to see a more detailed build log, uncomment the following line:
  // logLevel: "trace",
});
