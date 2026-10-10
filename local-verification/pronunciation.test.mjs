import { build } from "esbuild";
import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
const compiled = await build({
  entryPoints: ["src/modules/pronunciation.ts"],
  bundle: true,
  format: "esm",
  write: false,
});
writeFileSync(
  new URL(".speech-qa.mjs", import.meta.url),
  compiled.outputFiles[0].text,
);
const { playPronunciation, stopPronunciation } =
  await import("./.speech-qa.mjs");
const channels = [],
  played = [],
  revoked = [];
let mode = "success";
const win = {
  URL: {
    createObjectURL: (blob) => {
      played.push({ blob });
      return "blob:qa";
    },
    revokeObjectURL: (url) => revoked.push(url),
  },
  Blob,
  setTimeout,
  clearTimeout,
  Audio: class {
    constructor(url) {
      this.url = url;
    }
    addEventListener() {}
    pause() {
      this.paused = true;
    }
    async play() {
      played.at(-1).url = this.url;
    }
  },
};
const globals = {
  Services: {
    obs: { addObserver() {}, removeObserver() {} },
    uuid: { generateUUID: () => "{00000000-1111-2222-3333-444444444444}" },
    scriptSecurityManager: { getSystemPrincipal: () => ({}) },
    io: { newURI: (url) => url },
  },
  ChromeUtils: { generateQI: () => () => {} },
  Components: {
    interfaces: {
      nsICryptoHash: {},
      nsIWebSocketChannel: {},
      nsILoadInfo: { SEC_ALLOW_CROSS_ORIGIN_SEC_CONTEXT_IS_NULL: 0 },
      nsIContentPolicy: { TYPE_WEBSOCKET: 0 },
    },
    classes: {
      "@mozilla.org/security/hash;1": {
        createInstance: () => ({
          SHA256: 1,
          init() {
            this.hash = createHash("sha256");
          },
          update(a) {
            this.hash.update(Buffer.from(a));
          },
          finish() {
            return this.hash.digest().toString("latin1");
          },
        }),
      },
      "@mozilla.org/network/protocol;1?name=wss": {
        createInstance: () => {
          const c = {
            messages: [],
            initLoadInfo() {},
            close() {
              this.closed = true;
            },
            sendMsg(msg) {
              this.messages.push(msg);
            },
            asyncOpen(url, origin, attrs, id, listener) {
              Object.assign(this, { url, origin, listener });
              queueMicrotask(() => {
                listener.onStart();
                if (mode === "fail") {
                  listener.onStop(null, 1);
                  return;
                }
                if (mode === "hold") return;
                const header = "Path:audio\r\n";
                listener.onBinaryMessageAvailable(
                  null,
                  String.fromCharCode(0, header.length) + header + "MP3",
                );
                listener.onMessageAvailable(null, "Path:turn.end\r\n");
              });
            },
          };
          channels.push(c);
          return c;
        },
      },
    },
  },
};
globalThis.Zotero = { getMainWindow: () => win };
globalThis.ztoolkit = { getGlobal: (k) => globals[k] };
await playPronunciation("Mercury & coastal oceans < 10%");
assert.equal(played.length, 1);
assert.equal(played[0].blob.size, 3);
assert.match(channels[0].url, /Sec-MS-GEC=[A-F0-9]{64}/);
assert.match(channels[0].messages[1], /en-US-EmmaMultilingualNeural/);
assert.match(channels[0].messages[1], /Mercury &amp; coastal oceans &lt; 10%/);
assert.ok(channels[0].closed);
mode = "fail";
await assert.rejects(playPronunciation("Mercury"), /connection closed/);
assert.equal(revoked.length, 1);
mode = "hold";
const pending = playPronunciation("old selection");
await new Promise((r) => setTimeout(r, 0));
stopPronunciation();
await pending;
assert.ok(channels.at(-1).closed);
assert.equal(played.length, 1);
await assert.rejects(playPronunciation("x".repeat(6001)), /6000/);
console.log(
  "PASS: natural US protocol, MP3 binary frames, XML escaping, failures, cancellation, audio cleanup and selection limit.",
);
