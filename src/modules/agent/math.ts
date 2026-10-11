import katex from "katex";
const MATH_NS = "http://www.w3.org/1998/Math/MathML";
const cache = new Map<string, string>();
function mathMarkup(latex: string, display: boolean) {
  const key = `${display}:${latex}`;
  if (cache.has(key)) return cache.get(key)!;
  const value = katex.renderToString(latex, {
    output: "mathml",
    displayMode: display,
    throwOnError: true,
    trust: false,
    strict: "ignore",
    maxExpand: 1000,
    maxSize: 20,
  });
  if (cache.size >= 128) cache.delete(cache.keys().next().value!);
  cache.set(key, value);
  return value;
}
export function mathElement(doc: Document, latex: string, display = false) {
  const host = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "span",
  ) as HTMLElement;
  host.className = display ? "agent-math agent-math-block" : "agent-math";
  try {
    const parsed = new (
      doc.defaultView as Window & typeof globalThis
    ).DOMParser().parseFromString(
      `<div xmlns="http://www.w3.org/1999/xhtml">${mathMarkup(latex, display)}</div>`,
      "application/xhtml+xml",
    );
    const math = parsed.getElementsByTagNameNS(MATH_NS, "math")[0];
    if (!math) throw Error("Invalid formula");
    // Annotations contain the original TeX and would duplicate selected/copied text.
    math
      .querySelectorAll("annotation,annotation-xml")
      .forEach((n) => n.remove());
    math.setAttribute("data-latex", latex);
    math.setAttribute("data-display", String(display));
    host.append(doc.importNode(math, true));
    host.dataset.latex = latex;
    host.dataset.display = String(display);
    host.tabIndex = 0;
    host.setAttribute("role", "button");
    host.setAttribute("aria-label", `复制公式到 Word：${latex}`);
    host.title = "点击复制完整公式到 Word";
  } catch {
    host.className = "agent-math-error";
    host.textContent = latex;
    host.title = "公式语法暂不支持，保留原文";
  }
  return host;
}
function serialize(doc: Document, node: Node) {
  return new (
    doc.defaultView as Window & typeof globalThis
  ).XMLSerializer().serializeToString(node);
}
export function equationClipboard(doc: Document, equation: Element) {
  const math = equation.getElementsByTagNameNS(MATH_NS, "math")[0];
  if (!math) return undefined;
  const clean = math.cloneNode(true) as Element;
  clean.removeAttribute("data-latex");
  clean.removeAttribute("data-display");
  const mathml = serialize(doc, clean);
  return { plain: mathml, html: `<html><body>${mathml}</body></html>` };
}
export function selectionClipboard(doc: Document, selection: Selection) {
  const fragment = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
  for (let i = 0; i < selection.rangeCount; i++)
    fragment.append(selection.getRangeAt(i).cloneContents());
  const sourceEquation = (node: Node | null) =>
    (node?.nodeType === 1 ? (node as Element) : node?.parentElement)?.closest(
      ".agent-math",
    );
  const first = sourceEquation(selection.anchorNode),
    last = sourceEquation(selection.focusNode);
  // A partial selection of an equation copies the complete editable equation.
  if (first && first === last) return equationClipboard(doc, first)!;
  fragment.querySelectorAll(".agent-math").forEach((copy) => {
    const latex = (copy as HTMLElement).dataset.latex;
    if (!latex) return;
    const restored = mathElement(
      doc,
      latex,
      (copy as HTMLElement).dataset.display === "true",
    );
    const math = restored.getElementsByTagNameNS(MATH_NS, "math")[0];
    if (math) copy.replaceWith(math);
  });
  const equations = fragment.getElementsByTagNameNS(MATH_NS, "math");
  if (!equations.length) return { plain: selection.toString(), html: "" };
  Array.from(equations).forEach((copy) => {
    const latex = copy.getAttribute("data-latex");
    if (latex) {
      const restored = mathElement(
        doc,
        latex,
        copy.getAttribute("data-display") === "true",
      );
      const math = restored.getElementsByTagNameNS(MATH_NS, "math")[0];
      if (math) {
        math.removeAttribute("data-latex");
        math.removeAttribute("data-display");
        copy.replaceWith(math);
      }
    }
  });
  const currentMath = fragment.getElementsByTagNameNS(MATH_NS, "math");
  const outside = fragment.cloneNode(true) as Element;
  outside.querySelectorAll("math").forEach((n) => n.remove());
  if (currentMath.length === 1 && !outside.textContent?.trim())
    return equationClipboard(doc, fragment)!;
  return {
    plain: fragment.textContent || selection.toString(),
    html: `<html><body>${serialize(doc, fragment)}</body></html>`,
  };
}
export function copyMathContent(payload: { plain: string; html: string }) {
  const clipboard = new ztoolkit.Clipboard().addText(
    payload.plain,
    "text/plain",
  );
  if (payload.html) clipboard.addText(payload.html, "text/html");
  clipboard.copy();
}
