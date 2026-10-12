import { figureRects, evidenceStamp } from "./evidence";
import { SourceChunk } from "./context";
import { getCorpus, rootItem } from "./storage";
export interface PDFChar {
  u?: string;
  c?: string;
  rect?: number[];
}
const normalize = (value: string) =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
export function sourceRects(chars: PDFChar[], text: string): number[][] {
  let haystack = "";
  const offsets: number[] = [];
  for (let i = 0; i < chars.length; i++) {
    const value = normalize(chars[i].u || chars[i].c || "");
    haystack += value;
    for (let j = 0; j < value.length; j++) offsets.push(i);
  }
  const source = normalize(text);
  const needle = source;
  if (needle.length < 32) return [];
  const at = haystack.indexOf(needle);
  if (at < 0 || haystack.indexOf(needle, at + 1) >= 0) return [];
  const rectangles: number[][] = [];
  for (let i = offsets[at]; i <= offsets[at + needle.length - 1]; i++) {
    const original = chars[i].rect;
    if (!original || original.length !== 4 || !original.every(Number.isFinite))
      continue;
    const rect = [
      Math.min(original[0], original[2]),
      Math.min(original[1], original[3]),
      Math.max(original[0], original[2]),
      Math.max(original[1], original[3]),
    ];
    const last = rectangles.at(-1);
    if (
      last &&
      Math.abs(last[1] - rect[1]) < 2 &&
      Math.abs(last[3] - rect[3]) < 2 &&
      rect[0] >= last[0] &&
      rect[0] - last[2] < 20
    ) {
      last[2] = Math.max(last[2], rect[2]);
    } else rectangles.push([...rect]);
  }
  return rectangles;
}
const positions = new Map<string, number[][]>();
const views = new WeakMap<object, number>();
let nextView = 0;
export async function openCitation(
  item: Zotero.Item,
  id: string,
  sources: SourceChunk[] = [],
) {
  const root = rootItem(item);
  let source = sources.find((s) => s.id === id);
  if (!source?.attachmentKey || source.pageIndex === undefined)
    source = (await getCorpus(root)).chunks.find((s) => s.id === id);
  if (
    !source?.attachmentKey ||
    !Number.isInteger(source.pageIndex) ||
    source.pageIndex! < 0
  )
    throw Error("此引用没有可用的 PDF 位置");
  const pdf = Zotero.Items.getByLibraryAndKey(
    root.libraryID,
    source.attachmentKey,
  );
  if (
    !pdf ||
    (root.isAttachment() ? pdf.id !== root.id : pdf.parentID !== root.id) ||
    pdf.attachmentContentType !== "application/pdf"
  )
    throw Error("引用的 PDF 不属于当前条目，或附件已移除");
  if (!(await pdf.getFilePathAsync())) throw Error("引用的 PDF 文件不可用");
  const corpus = source.anchor ? await getCorpus(root) : undefined;
  if (
    source.anchor?.stamp &&
    evidenceStamp(corpus?.pdfStamps?.[source.attachmentKey]) !==
      evidenceStamp(source.anchor.stamp)
  )
    throw Error("PDF 已变化，请重新提问以核对引用位置");
  const pageIndex = source.pageIndex!;
  let reader = await Zotero.Reader.open(pdf.id, {
    pageIndex: pageIndex,
  });
  // A restored/unloaded attachment tab opens asynchronously and initially returns undefined.
  for (let attempt = 0; !reader && attempt < 40; attempt++) {
    await new Promise((resolve) =>
      Zotero.getMainWindow().setTimeout(resolve, 150),
    );
    reader = (Zotero.Reader as any)._readers?.find(
      (r: any) => r.itemID === pdf.id && !r._isTabClosed,
    );
  }
  if (!reader) return { pageIndex: pageIndex, located: false };
  // Native reader internals differ across Zotero versions; page navigation always remains available.
  let rectangles: number[][] = [];
  try {
    if ((reader as any)._initPromise) await (reader as any)._initPromise;
    const native = (reader as any)._internalReader;
    const view = native?._primaryView;
    if (view?.initializedPromise) await view.initializedPromise;
    if (view && !views.has(view)) views.set(view, ++nextView);
    const key = `${views.get(view) || 0}:${pdf.libraryID}:${pdf.key}:${pdf.dateModified}:${source.id}`;
    if (positions.has(key)) rectangles = positions.get(key)!;
    else {
      let data = view?._pdfPages?.[pageIndex];
      if (!data && view?._ensureBasicPageData) {
        await view._ensureBasicPageData(pageIndex);
        data = view._pdfPages?.[pageIndex];
      }
      if (!data) {
        const iframe = view?._iframeWindow;
        const doc = (iframe?.wrappedJSObject || iframe)?.PDFViewerApplication
          ?.pdfDocument;
        if (doc?.getPageData) data = await doc.getPageData({ pageIndex });
      }
      if (data) {
        rectangles = sourceRects(
          data.chars || [],
          source.anchor?.quote || source.text,
        );
        if (positions.size >= 64)
          positions.delete(positions.keys().next().value!);
        positions.set(key, rectangles);
      }
    }
    const iframe = view?._iframeWindow;
    const viewer = (iframe?.wrappedJSObject || iframe)?.PDFViewerApplication
      ?.pdfViewer;
    const bounds = viewer?._pages?.[pageIndex]?.viewport?.viewBox;
    if (bounds && source.anchor?.kind === "figure" && source.anchor.region)
      rectangles = figureRects(source.anchor.region, bounds);
    if (bounds)
      rectangles = rectangles.filter(
        (r) =>
          r[0] >= bounds[0] - 2 &&
          r[1] >= bounds[1] - 2 &&
          r[2] <= bounds[2] + 2 &&
          r[3] <= bounds[3] + 2,
      );
    if (rectangles.length)
      await reader.navigate({
        position: { pageIndex: pageIndex, rects: rectangles },
      });
  } catch {
    rectangles = [];
    /* Missing coordinates or an older reader: keep the exact PDF page. */
  }
  return { pageIndex: pageIndex, located: rectangles.length > 0 };
}
