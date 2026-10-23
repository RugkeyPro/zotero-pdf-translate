export interface SourceChunk {
  id: string;
  source: string;
  text: string;
  attachmentKey?: string;
  pageIndex?: number;
}
export interface Corpus {
  fingerprint: string;
  schema?: number;
  title: string;
  chunks: SourceChunk[];
  overview: string;
  warnings: string[];
  pdfCount: number;
  pdfStamps?: Record<string, string>;
  cachedAt?: number;
}
export interface Message {
  role: "user" | "assistant";
  content: string;
  status?: "complete" | "stopped" | "error";
  sources?: SourceChunk[];
  selection?: string;
  model?: string;
  created: number;
}
export interface Conversation {
  id: string;
  title: string;
  model: string;
  messages: Message[];
  summary: string;
  summarized: number;
  updated: number;
}
export interface ItemChats {
  version: 1;
  current: string;
  conversations: Conversation[];
}
export function splitSource(
  source: string,
  text: string,
  prefix: string,
): SourceChunk[] {
  const clean = text
    .replace(/\r/g, "")
    .split(String.fromCharCode(0))
    .join("")
    .trim();
  const chunks: SourceChunk[] = [];
  for (let start = 0; start < clean.length; start += 1500)
    chunks.push({
      id: `${prefix}-${chunks.length + 1}`,
      source,
      text: clean.slice(start, start + 1800),
    });
  return chunks;
}
function terms(text: string) {
  const lower = text.toLowerCase();
  const english = lower.match(/[a-z][a-z0-9-]{2,}/g) || [];
  const chinese = lower.match(/[\u4e00-\u9fff]{2,}/g) || [];
  return [
    ...new Set([
      ...english,
      ...chinese.flatMap((s) =>
        Array.from({ length: s.length - 1 }, (_, i) => s.slice(i, i + 2)),
      ),
    ]),
  ];
}
export function searchChunks(chunks: SourceChunk[], query: string, limit = 6) {
  const keywords = terms(query);
  return chunks
    .map((chunk, i) => {
      const text = chunk.text.toLowerCase();
      const score = keywords.reduce(
        (n, k) => n + (text.includes(k) ? 1 + Math.min(k.length, 12) / 12 : 0),
        0,
      );
      return { chunk, score, i };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, Math.min(limit, 8))
    .map((x) => x.chunk);
}
export function coverage(chunks: SourceChunk[], limit = 12) {
  const groups = new Map<string, SourceChunk[]>();
  for (const c of chunks) {
    const list = groups.get(c.attachmentKey || c.source) || [];
    list.push(c);
    groups.set(c.attachmentKey || c.source, list);
  }
  const picked: SourceChunk[] = [];
  for (const list of groups.values())
    for (const index of [0, Math.floor(list.length / 2), list.length - 1]) {
      const c = list[index];
      if (c && !picked.some((x) => x.id === c.id)) picked.push(c);
    }
  return picked
    .sort((a, b) => Number(!a.id.endsWith("-1")) - Number(!b.id.endsWith("-1")))
    .slice(0, limit);
}
// Retrieval IDs stay internal; keep human references such as Fig. 2 and Table S1.
export function cleanAnswer(text: string) {
  const id = String.raw`(?:PDF[A-Z0-9]+-(?:[TF][A-F0-9]+|\d+)|NOTE[A-Z0-9]+-\d+|ANN[A-Z0-9]+-\d+|META-\d+)`;
  return text
    .replace(
      new RegExp(
        String.raw`[ \t]*\[\s*${id}(?:\s*[,，;；、–—]\s*${id})*\s*\]`,
        "g",
      ),
      "",
    )
    .replace(new RegExp(String.raw`\b${id}\b`, "g"), "")
    .replace(
      /\[\s*(?:PDF[A-Z0-9]+|NOTE[A-Z0-9]+|ANN[A-Z0-9]+|META-)[A-Z0-9,;\s-]*$/,
      "",
    )
    .trim();
}
export function formatSources(chunks: SourceChunk[]) {
  return chunks.map((c) => `[${c.id}] ${c.source}\n${c.text}`).join("\n\n");
}
export function recentHistory(conversation: Conversation, budget = 16000) {
  const result: { role: string; content: string }[] = [];
  for (const m of conversation.messages
    .slice(conversation.summarized)
    .reverse()) {
    if (m.status === "error" || !m.content) continue;
    const content = (
      m.role === "assistant" ? cleanAnswer(m.content) : m.content
    ).slice(0, 8000);
    if (result.length && budget < content.length) break;
    result.unshift({ role: m.role, content });
    budget -= content.length;
    if (result.length >= 10) break;
  }
  return result;
}

export function splitPDF(
  source: string,
  text: string,
  key: string,
  totalPages?: number,
): SourceChunk[] {
  const pages = text.split("\f");
  while (totalPages && pages.length < totalPages) pages.push("");
  return pages.flatMap((page, pageIndex) =>
    splitSource(
      `${source} · PDF 第${pageIndex + 1}页`,
      page || "此页无可提取文字，可读取完整页面图像。",
      `PDF${key}P${pageIndex + 1}`,
    ).map((chunk) => ({ ...chunk, attachmentKey: key, pageIndex })),
  );
}
