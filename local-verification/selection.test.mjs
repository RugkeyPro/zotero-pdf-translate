import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { writeFileSync } from "node:fs";
import assert from "node:assert/strict";
const compiled = await build({
  entryPoints: ["src/modules/popup.ts"],
  bundle: true,
  format: "esm",
  write: false,
  plugins: [
    {
      name: "host",
      setup(b) {
        b.onResolve(
          { filter: /modules\/pronunciation$|^\.\/pronunciation$/ },
          (a) => ({ path: a.path, namespace: "speech" }),
        );
        b.onLoad({ filter: /.*/, namespace: "speech" }, () => ({
          contents:
            "export const playPronunciation = async text => globalThis.speechCalls.push(text);",
        }));
        b.onResolve(
          { filter: /utils\/(task|prefs|locale|config|str)$/ },
          (a) => ({ path: a.path, namespace: "host" }),
        );
        b.onLoad({ filter: /.*/, namespace: "host" }, (a) => ({
          contents: a.path.endsWith("/task")
            ? "export const getLastTranslateTask = () => globalThis.currentTask; export const addTranslateTask = () => globalThis.currentTask;"
            : a.path.endsWith("/prefs")
              ? "export const getPref = k => globalThis.preferences[k]; export const setPref = () => {};"
              : a.path.endsWith("/locale")
                ? "export const getString = k => k;"
                : a.path.endsWith("/config")
                  ? 'export const SVGIcon = "";'
                  : "export const slice = (s,n) => s.slice(0,n);",
        }));
      },
    },
  ],
});
writeFileSync(
  new URL(".qa-bundle.mjs", import.meta.url),
  compiled.outputFiles[0].text,
);
const { buildReaderPopup, updateReaderPopup } =
  await import("./.qa-bundle.mjs");
globalThis.speechCalls = [];
function create(doc, s) {
  const e =
    s.tag === "fragment"
      ? doc.createDocumentFragment()
      : doc.createElement(s.tag);
  if (s.id) e.id = s.id;
  if (s.classList) e.classList.add(...s.classList);
  for (const [k, v] of Object.entries(s.attributes || {})) e.setAttribute(k, v);
  Object.assign(e.style || {}, s.styles || {});
  Object.assign(e, s.properties || {});
  for (const l of s.listeners || []) e.addEventListener(l.type, l.listener);
  for (const c of s.children || []) e.append(create(doc, c));
  return e;
}
globalThis.preferences = {
  enablePopup: true,
  showPlayBtn: true,
  fontSize: 12,
  lineHeight: 1.5,
  enableAuto: true,
  enableNote: false,
};
globalThis.Zotero = {
  getMainWindow: () => ({ ZoteroContextPane: {} }),
  Promise: { delay: (ms) => new Promise((r) => setTimeout(r, ms)) },
};
globalThis.ztoolkit = {
  UI: {
    createElement: (doc, tag, opts) => create(doc, { tag, ...opts }),
    appendElement: (s, e) => e.append(create(e.ownerDocument, s)),
  },
  getGlobal: () =>
    class {
      constructor(url) {
        this.url = url;
      }
      async play() {}
      pause() {}
    },
  ProgressWindow: class {
    createLine() {
      return this;
    }
    show() {}
  },
};
async function fixture(status = "success") {
  const { window } = new JSDOM(
    '<body><div class="selection-popup"><div class="colors"><button class="color-button">Yellow</button></div></div></body>',
  );
  const doc = window.document;
  const annotation = {
    text: "Mercury",
    comment: "",
    position: { pageIndex: 0 },
  };
  const saved = [];
  globalThis.currentTask = {
    id: "test",
    type: "text",
    raw: "Mercury",
    itemId: 123,
    status,
    result: status === "success" ? "汞" : "",
    audio: [],
    langto: "zh-CN",
  };
  globalThis.addon = {
    data: { popup: {}, translate: { selectedText: "Mercury" } },
    hooks: {
      onTranslate: async (task) => {
        task.status = "success";
        task.result = "汞";
        updateReaderPopup();
      },
    },
  };
  // The installed Zotero reader spreads params.annotation in its native handler.
  doc.addEventListener("click", (ev) => {
    if (ev.target.closest(".color-button"))
      saved.push({ ...annotation, type: "highlight", color: "#ffd400" });
  });
  buildReaderPopup({
    reader: { itemID: 123, _instanceID: "qa" },
    doc,
    params: { annotation },
    append: (e) => doc.querySelector(".selection-popup").append(e),
  });
  updateReaderPopup();
  return {
    doc,
    annotation,
    saved,
    button: doc.querySelector(".color-button"),
    task: currentTask,
  };
}
let f = await fixture();
f.button.click();
assert.equal(f.saved[0].comment, "汞");
assert.equal(f.saved[0].color, "#ffd400");
f = await fixture();
f.doc.querySelector("textarea").value = "水银（手动修订）";
f.button.click();
assert.equal(f.saved[0].comment, "水银（手动修订）");
f = await fixture("waiting");
f.button.click();
await new Promise((r) => setTimeout(r, 20));
assert.equal(f.saved.length, 1);
assert.equal(f.saved[0].comment, "汞");
f = await fixture("processing");
f.button.click();
f.button.click();
setTimeout(() => {
  f.task.result = "汞";
  f.task.status = "success";
  updateReaderPopup();
}, 10);
await new Promise((r) => setTimeout(r, 150));
assert.equal(f.saved.length, 1);
assert.equal(f.saved[0].comment, "汞");
f = await fixture("fail");
f.task.result = "network error";
f.button.click();
await new Promise((r) => setTimeout(r, 10));
assert.equal(f.saved[0].comment, "");
f = await fixture();
f.task.raw = "other selection";
f.button.click();
assert.equal(f.saved[0].comment, "");
f = await fixture();
const audioButtons = [...f.doc.querySelectorAll("button")].filter(
  (b) => b.textContent === "🔊",
);
assert.equal(audioButtons.length, 1);
for (const b of audioButtons) b.click();
await new Promise((r) => setTimeout(r, 5));
assert.deepEqual(globalThis.speechCalls, ["Mercury"]);
console.log(
  "PASS: native highlight saves translation, edited result, waiting/processing (no duplicate), failed translation, cross-selection safety, and a single US speaker button.",
);

f = await fixture();
f.task.raw = "Mercury is a potent neurotoxic substance.";
f.doc.querySelector(".selection-popup").dataset.selectionText = f.task.raw;
updateReaderPopup();
f.doc.querySelector('[aria-label="朗读原文（美音）"]').click();
await new Promise((r) => setTimeout(r, 5));
assert.equal(globalThis.speechCalls.at(-1), f.task.raw);
console.log(
  "PASS: single speaker sends the full selected sentence to natural US speech.",
);
