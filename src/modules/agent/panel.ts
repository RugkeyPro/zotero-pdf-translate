import { ItemChats, Conversation } from "./context";
import {
  rootItem,
  itemKey,
  loadChats,
  saveChats,
  newConversation,
  DEFAULT_MODEL,
  getCorpus,
} from "./storage";
import {
  activity,
  sendChat,
  stopChat,
  saveAnswerNote,
  subscribe,
  selections,
  changed,
} from "./chat";
import { configureProvider, getProvider, listModels } from "./provider";
const CSS = `
.agent-pane{width:100%;min-width:0;font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--color-paned-text,#252a31);background:var(--material-background,#f8fafc);border-radius:16px;display:flex;flex-direction:column;min-height:470px;height:var(--agent-height,650px);max-height:850px;box-sizing:border-box;overflow:hidden;border:1px solid var(--color-border,#e3e8ef)}
.agent-pane *{box-sizing:border-box}.agent-pane button,.agent-pane select,.agent-pane input,.agent-pane textarea{font:inherit;color:inherit}.agent-pane button{cursor:pointer;border:0;background:transparent;border-radius:16px;padding:7px 11px}.agent-pane button:hover{background:#dfe9fb;color:#243b63}.agent-pane button:disabled{opacity:.45;cursor:default}.agent-top{display:flex;gap:4px;padding:10px 9px;align-items:center}.agent-top select{min-width:0;width:0;flex:1;background:transparent;border:0;text-overflow:ellipsis}.agent-title{font-size:12px;padding:0 14px;color:var(--color-text-secondary,#5e6571);line-height:1.5;max-height:38px;overflow:hidden}.agent-thread{flex:1;overflow-y:auto;padding:14px;min-height:180px}.agent-welcome{padding:36px 5px}.agent-star{font-size:34px;background:linear-gradient(30deg,#4285f4,#8b72e5,#d96fb3,#e9b942);background-clip:text;color:transparent}.agent-welcome h2{font-size:24px;font-weight:500;line-height:1.35;margin:12px 0 25px}.agent-suggestions{display:flex;flex-direction:column;align-items:flex-start;gap:9px}.agent-suggestions button{background:var(--material-background,#fff);border:1px solid var(--color-border,#e0e5ed);box-shadow:0 2px 8px #00000006;text-align:left}.agent-message{margin:0 0 18px;line-height:1.65;overflow-wrap:anywhere}.agent-message.user{background:#e8edf8;color:#25334c;border-radius:16px;padding:10px 12px;margin-left:24px}.agent-message.assistant .agent-label{font-size:11px;color:var(--color-text-secondary,#697386);margin-bottom:6px}.agent-prose{white-space:pre-wrap}.agent-message details{font-size:11px;margin-top:8px}.agent-message details p{white-space:pre-wrap;border-left:2px solid #9baff1;padding-left:8px;max-height:240px;overflow:auto}.agent-message .agent-save{font-size:11px;padding-left:0}.agent-status{font-size:11px;color:var(--color-text-secondary,#61708a);padding:0 14px 6px;min-height:21px}.agent-compose{margin:0 10px 10px;padding:10px;border:1px solid var(--color-border,#dce3ed);background:var(--material-background,#fff);border-radius:20px;box-shadow:0 2px 10px #00000008}.agent-context{font-size:11px;margin-bottom:5px;display:flex;gap:6px;align-items:center}.agent-context select{max-width:110px;border:0;background:transparent}.agent-context span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;color:var(--color-text-secondary,#697386)}.agent-compose textarea{width:100%;min-height:55px;max-height:130px;resize:vertical;border:0;outline:none;background:transparent;line-height:1.5}.agent-actions{display:flex;align-items:center;justify-content:space-between;gap:4px}.agent-actions select{min-width:0;font-size:11px;border:0;background:transparent;max-width:75%;width:0;flex:1}.agent-send{background:#dce9ff!important;color:#294983!important}.agent-settings{padding:10px;border-bottom:1px solid var(--color-border,#e0e5ed)}.agent-settings input{width:100%;margin-bottom:7px;border:1px solid var(--color-border,#ddd);border-radius:8px;padding:6px;background:var(--material-background,#fff)}.agent-privacy{font-size:10px;line-height:1.5;color:var(--color-text-secondary,#7a818e);padding:0 14px 10px}.agent-selected{font-size:11px;max-height:60px;overflow:auto;white-space:pre-wrap;background:#edf3ff;color:#3b4b67;border-radius:8px;margin-bottom:6px;padding:6px}
@media(prefers-color-scheme:dark){.agent-message.user,.agent-selected{background:#29334a;color:#dce5f7}.agent-pane button:hover{background:#303f5b;color:#dce5f7}.agent-send{background:#334970!important;color:#e1eaff!important}}
`;
export class AgentPanel {
  private item?: Zotero.Item;
  private state?: ItemChats;
  private ticket = 0;
  private disposed = false;
  private models = [DEFAULT_MODEL];
  private unsubscribe: () => void;
  private scheduled = false;
  private doc: Document;
  private pane: HTMLElement;
  private thread: HTMLElement;
  private status: HTMLElement;
  private input: HTMLTextAreaElement;
  private threads: HTMLSelectElement;
  private model: HTMLSelectElement;
  private scope: HTMLSelectElement;
  private context: HTMLElement;
  private selected: HTMLElement;
  private send: HTMLButtonElement;
  constructor(private body: HTMLElement) {
    this.doc = body.ownerDocument;
    const markup = `<style xmlns="http://www.w3.org/1999/xhtml">${CSS}</style><div xmlns="http://www.w3.org/1999/xhtml" class="agent-pane"><div class="agent-top"><select aria-label="对话列表"></select><button type="button" data-action="new" title="新建对话">＋</button><button type="button" data-action="delete" title="删除当前对话">⌫</button><button type="button" data-action="settings" title="CPA 连接设置">⚙</button></div><div class="agent-title"></div><div class="agent-settings" hidden="hidden"><input aria-label="CPA 接口地址" placeholder="https://…/v1"/><input aria-label="CPA API 密钥" type="password" placeholder="密钥（留空保留现有）" autocomplete="off"/><button type="button" data-action="connect">保存连接并刷新模型</button></div><div class="agent-thread" role="log" aria-label="文献对话"></div><div class="agent-status" role="status"></div><div class="agent-compose"><div class="agent-context"><select aria-label="阅读范围"><option value="item">整个条目</option><option value="selection">选中文字</option></select><span></span><button type="button" data-action="selection" title="引用当前 PDF 选区">＋选区</button></div><div class="agent-selected" hidden="hidden"></div><textarea aria-label="提问" placeholder="问问这篇文献…"></textarea><div class="agent-actions"><select aria-label="对话模型"></select><button class="agent-send" type="button" data-action="send" title="发送或停止">↑</button></div></div><div class="agent-privacy">发送时将相关原文与对话交给 CPA；全文缓存和会话保存在本机。</div></div>`;
    const parsed = new (
      this.doc.defaultView as Window & typeof globalThis
    ).DOMParser().parseFromString(
      `<div xmlns="http://www.w3.org/1999/xhtml">${markup}</div>`,
      "application/xhtml+xml",
    );
    body.replaceChildren(
      ...Array.from(parsed.documentElement.childNodes).map((node) =>
        this.doc.importNode(node!, true),
      ),
    );
    this.pane = body.querySelector(".agent-pane")!;
    this.thread = body.querySelector(".agent-thread")!;
    this.status = body.querySelector(".agent-status")!;
    this.input = body.querySelector("textarea")!;
    this.threads = body.querySelector('[aria-label="对话列表"]')!;
    this.model = body.querySelector('[aria-label="对话模型"]')!;
    this.scope = body.querySelector('[aria-label="阅读范围"]')!;
    this.context = body.querySelector(".agent-context span")!;
    this.selected = body.querySelector(".agent-selected")!;
    this.send = body.querySelector('[data-action="send"]')!;
    body.addEventListener("click", this.click);
    this.threads.onchange = () => {
      if (this.state && this.item) {
        this.state.current = this.threads.value;
        void saveChats(this.item, this.state);
        this.render();
      }
    };
    this.model.onchange = () => {
      const c = this.current();
      if (c && this.item && this.state) {
        c.model = this.model.value;
        void saveChats(this.item, this.state);
      }
    };
    this.scope.onchange = () => this.refreshSelection();
    this.input.onkeydown = (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        void this.submit();
      }
    };
    this.unsubscribe = subscribe(() => this.schedule());
    void this.refreshModels();
  }
  private el<T extends keyof HTMLElementTagNameMap>(
    tag: T,
  ): HTMLElementTagNameMap[T] {
    return this.doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      tag,
    ) as HTMLElementTagNameMap[T];
  }
  private current(): Conversation | undefined {
    return this.state?.conversations.find((c) => c.id === this.state?.current);
  }
  private schedule() {
    if (this.scheduled || this.disposed) return;
    this.scheduled = true;
    this.doc.defaultView!.requestAnimationFrame(() => {
      this.scheduled = false;
      if (!this.disposed) this.render();
    });
  }
  async setItem(item: Zotero.Item) {
    const root = rootItem(item);
    if (this.item?.id === root.id) return;
    this.item = root;
    this.state = undefined;
    this.input.value = "";
    this.scope.value = "item";
    const ticket = ++this.ticket;
    this.thread.textContent = "加载条目对话…";
    try {
      const state = await loadChats(root);
      if (ticket !== this.ticket || this.disposed) return;
      this.state = state;
      this.render();
    } catch {
      this.status.textContent = "本地会话读取失败，请检查数据目录权限";
    }
  }
  private async refreshModels() {
    try {
      this.models = await listModels();
      this.render();
    } catch {
      this.status.textContent = "可在连接设置中检查 CPA；暂使用默认模型";
    }
  }
  private refreshSelection() {
    const selection = this.item
      ? selections.get(itemKey(this.item))
      : undefined;
    const enabled = this.scope.value === "selection";
    this.selected.hidden = !enabled;
    this.selected.textContent = enabled
      ? selection?.text || "先在 PDF 中划选文字，再点击“＋选区”"
      : "";
    this.context.textContent = enabled
      ? "只读选区，不检索条目全文"
      : "全部 PDF · 元数据 · 笔记 · 注释";
  }
  private render() {
    if (!this.item || !this.state || this.disposed) return;
    const c = this.current();
    if (!c) return;
    const busy = activity(this.item, c.id);
    this.body.querySelector(".agent-title")!.textContent = String(
      this.item.getField("title"),
    );
    this.threads.replaceChildren(
      ...this.state.conversations.map((t) => {
        const o = this.el("option");
        o.value = t.id;
        o.textContent = t.title;
        return o;
      }),
    );
    this.threads.value = c.id;
    this.model.replaceChildren(
      ...[...new Set([c.model, ...this.models])].map((m) => {
        const o = this.el("option");
        o.value = m;
        o.textContent = m;
        return o;
      }),
    );
    this.model.value = c.model;
    this.model.disabled = !!busy;
    this.send.textContent = busy ? "■" : "↑";
    this.send.setAttribute("aria-label", busy ? "停止生成" : "发送问题");
    this.status.textContent =
      busy ||
      (c.summary
        ? "早期对话已压缩 · 最近上下文保留"
        : "条目独立对话 · 本地全文缓存");
    this.refreshSelection();
    const bottom =
      this.thread.scrollHeight -
        this.thread.scrollTop -
        this.thread.clientHeight <
      90;
    this.thread.replaceChildren();
    if (!c.messages.length) {
      const welcome = this.el("div");
      welcome.className = "agent-welcome";
      const welcomeMarkup =
        '<div class="agent-star">✦</div><h2>一起读懂这篇文献</h2><div class="agent-suggestions"><button type="button">总结研究问题、方法和结论</button><button type="button">解释这篇论文的创新与局限</button><button type="button">整理关键数据与证据</button></div>';
      const parsedWelcome = new (
        this.doc.defaultView as Window & typeof globalThis
      ).DOMParser().parseFromString(
        `<div xmlns="http://www.w3.org/1999/xhtml">${welcomeMarkup}</div>`,
        "application/xhtml+xml",
      );
      welcome.replaceChildren(
        ...Array.from(parsedWelcome.documentElement.childNodes).map((node) =>
          this.doc.importNode(node!, true),
        ),
      );
      welcome.querySelectorAll("button").forEach(
        (b) =>
          (b.onclick = () => {
            this.input.value = b.textContent || "";
            void this.submit();
          }),
      );
      this.thread.append(welcome);
    }
    for (const m of c.messages) {
      const card = this.el("div");
      card.className = `agent-message ${m.role}`;
      if (m.role === "assistant") {
        const label = this.el("div");
        label.className = "agent-label";
        label.textContent = `✦ 文献助手 · ${m.model || c.model}`;
        card.append(label);
      }
      const text = this.el("div");
      text.className = "agent-prose";
      text.textContent = m.content || (busy ? "正在思考…" : "");
      card.append(text);
      if (m.selection) {
        const q = this.el("details");
        const title = this.el("summary");
        title.textContent = "本轮选区";
        const p = this.el("p");
        p.textContent = m.selection;
        q.append(title, p);
        card.append(q);
      }
      if (m.sources?.length) {
        const details = this.el("details");
        const label = this.el("summary");
        label.textContent = `参考原文 · ${m.sources.length} 个片段`;
        details.append(label);
        for (const source of m.sources) {
          const p = this.el("p");
          p.textContent = `[${source.id}] ${source.source}\n${source.text}`;
          details.append(p);
        }
        card.append(details);
      }
      if (
        m.role === "assistant" &&
        m.content &&
        !busy &&
        m.status !== "error"
      ) {
        const b = this.el("button");
        b.type = "button";
        b.className = "agent-save";
        b.textContent = "保存到条目笔记";
        b.onclick = async () => {
          b.disabled = true;
          try {
            await saveAnswerNote(this.item!, c, m);
            b.textContent = "已保存 ✓";
          } catch {
            b.textContent = "保存失败，点击重试";
            b.disabled = false;
          }
        };
        card.append(b);
      }
      this.thread.append(card);
    }
    if (bottom || busy) this.thread.scrollTop = this.thread.scrollHeight;
  }
  private async submit() {
    const item = this.item,
      c = this.current();
    if (!item || !c) return;
    if (activity(item, c.id)) {
      stopChat(item, c.id);
      return;
    }
    const question = this.input.value.trim();
    if (!question) return;
    const selection =
      this.scope.value === "selection"
        ? selections.get(itemKey(item))?.text
        : "";
    if (this.scope.value === "selection" && !selection) {
      this.status.textContent = "请先在当前条目的 PDF 中划选原文";
      return;
    }
    this.input.value = "";
    try {
      await sendChat(item, c, question, selection);
    } catch {
      this.status.textContent = "会话保存失败，请检查数据目录权限";
    }
  }
  private click = (event: Event) => {
    const action = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-action]",
    )?.dataset.action;
    if (!action || !this.item || !this.state) return;
    void this.handle(action);
  };
  private async handle(action: string) {
    const item = this.item!,
      state = this.state!,
      c = this.current()!;
    try {
      if (action === "send") {
        await this.submit();
        return;
      }
      if (action === "selection") {
        this.scope.value = "selection";
        this.refreshSelection();
        this.input.focus();
        return;
      }
      if (action === "new") {
        const next = newConversation(c.model);
        state.conversations.push(next);
        state.current = next.id;
        await saveChats(item, state);
        this.render();
        return;
      }
      if (action === "delete") {
        if (activity(item, c.id)) {
          this.status.textContent = "请先停止当前生成";
          return;
        }
        if (
          !Zotero.getMainWindow().confirm(
            "删除当前对话？全文缓存和已保存的 Zotero 笔记会保留。",
          )
        )
          return;
        state.conversations = state.conversations.filter((x) => x.id !== c.id);
        if (!state.conversations.length)
          state.conversations.push(newConversation(c.model));
        state.current = state.conversations[0].id;
        await saveChats(item, state);
        this.render();
        return;
      }
      if (action === "settings") {
        const settings =
          this.body.querySelector<HTMLElement>(".agent-settings")!;
        settings.hidden = !settings.hidden;
        if (!settings.hidden) {
          try {
            this.body.querySelector<HTMLInputElement>(
              '[aria-label="CPA 接口地址"]',
            )!.value = (await getProvider()).endpoint;
          } catch {
            /* Empty first connection. */
          }
        }
        return;
      }
      if (action === "connect") {
        const endpoint = this.body.querySelector<HTMLInputElement>(
          '[aria-label="CPA 接口地址"]',
        )!;
        const secret = this.body.querySelector<HTMLInputElement>(
          '[aria-label="CPA API 密钥"]',
        )!;
        await configureProvider(endpoint.value, secret.value);
        secret.value = "";
        await this.refreshModels();
        this.body.querySelector<HTMLElement>(".agent-settings")!.hidden = true;
        this.status.textContent = "CPA 连接已更新";
      }
    } catch (e) {
      this.status.textContent = (e as Error).message || "操作失败";
    }
  }
  dispose() {
    this.disposed = true;
    this.ticket++;
    this.unsubscribe();
    this.body.removeEventListener("click", this.click);
  }
}
