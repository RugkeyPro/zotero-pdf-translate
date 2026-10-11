import { mathElement } from "./math";
// Render a small Markdown subset using text nodes; never insert model HTML.
export function renderMarkdown(
  doc: Document,
  target: HTMLElement,
  text: string,
  citation?: (id: string) => HTMLElement,
) {
  const el = (tag: string) =>
    doc.createElementNS("http://www.w3.org/1999/xhtml", tag) as HTMLElement;
  const inline = (node: HTMLElement, source: string) => {
    const pattern =
      /(`[^`\n]+`|\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|(?<!\\)\$(?!\$)[^$\n]+?\$|\bPDF[A-Z0-9]+P\d+-\d+\b|\*\*[^*\n]+\*\*|\*[^*\n]+\*|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\))/g;
    let at = 0;
    for (const match of source.matchAll(pattern)) {
      node.append(doc.createTextNode(source.slice(at, match.index)));
      const token = match[0];
      let child: HTMLElement;
      if (/^PDF[A-Z0-9]+P\d+-\d+$/.test(token)) {
        child = citation ? citation(token) : el("span");
        if (!citation) child.textContent = token;
      } else if (
        token.startsWith("$") ||
        token.startsWith("\\[") ||
        token.startsWith("\\(")
      ) {
        const display = token.startsWith("$$") || token.startsWith("\\[");
        const trim = token.startsWith("$") && !display ? 1 : 2;
        child = mathElement(doc, token.slice(trim, -trim).trim(), display);
      } else if (token.startsWith("`")) {
        child = el("code");
        child.textContent = token.slice(1, -1);
      } else if (token.startsWith("**")) {
        child = el("strong");
        inline(child, token.slice(2, -2));
      } else if (token.startsWith("*")) {
        child = el("em");
        inline(child, token.slice(1, -1));
      } else {
        const m = token.match(/^\[([^\]]+)\]\((.+)\)$/)!;
        child = el("a");
        child.textContent = m[1];
        child.setAttribute("href", m[2]);
        child.setAttribute("target", "_blank");
        child.setAttribute("rel", "noopener noreferrer");
      }
      node.append(child);
      at = match.index! + token.length;
    }
    node.append(doc.createTextNode(source.slice(at)));
  };
  target.replaceChildren();
  const lines = text.replace(/\r/g, "").split("\n");
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) {
      const p = el("p");
      inline(p, paragraph.join("\n"));
      target.append(p);
      paragraph = [];
    }
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("```")) {
      flush();
      const pre = el("pre"),
        code = el("code");
      const content: string[] = [];
      while (++i < lines.length && !lines[i].startsWith("```"))
        content.push(lines[i]);
      code.textContent = content.join("\n");
      pre.append(code);
      target.append(pre);
      continue;
    }
    if (/^\s*(\$\$|\\\[)/.test(line)) {
      flush();
      const content = [line];
      const closing = line.trim().startsWith("$$") ? "$$" : "\\]";
      const openingLength = line.indexOf(line.trim()) + 2;
      if (!line.slice(openingLength).includes(closing)) {
        while (i + 1 < lines.length) {
          content.push(lines[++i]);
          if (lines[i].includes(closing)) break;
        }
      }
      const p = el("div");
      inline(p, content.join("\n"));
      target.append(p);
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    if (
      /^\s*\|?.+\|.+$/.test(line) &&
      /^\s*\|?\s*:?-{3,}/.test(lines[i + 1] || "")
    ) {
      flush();
      const wrap = el("div");
      wrap.className = "agent-table";
      const table = el("table");
      const cells = (s: string) =>
        s
          .trim()
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((x) => x.trim());
      const head = el("tr");
      for (const value of cells(line)) {
        const th = el("th");
        inline(th, value);
        head.append(th);
      }
      table.append(head);
      i++;
      while (i + 1 < lines.length && lines[i + 1].includes("|")) {
        const row = el("tr");
        for (const value of cells(lines[++i])) {
          const td = el("td");
          inline(td, value);
          row.append(td);
        }
        table.append(row);
      }
      wrap.append(table);
      target.append(wrap);
      continue;
    }
    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading) {
      flush();
      const h = el("h3");
      inline(h, heading[1]);
      target.append(h);
      continue;
    }
    const list = line.match(/^\s*(?:[-*+]\s+|\d+[.)]\s+)(.+)$/);
    if (list) {
      flush();
      const ordered = /^\s*\d/.test(line);
      const group = el(ordered ? "ol" : "ul");
      if (ordered) group.setAttribute("start", line.match(/^\s*(\d+)/)![1]);
      let value = list[1];
      while (true) {
        const li = el("li");
        inline(li, value);
        group.append(li);
        const next = lines[i + 1]?.match(
          ordered ? /^\s*\d+[.)]\s+(.+)$/ : /^\s*[-*+]\s+(.+)$/,
        );
        if (!next) break;
        value = next[1];
        i++;
      }
      target.append(group);
      continue;
    }
    if (line.startsWith("> ")) {
      flush();
      const q = el("blockquote");
      inline(q, line.slice(2));
      target.append(q);
      continue;
    }
    paragraph.push(line);
  }
  flush();
}
