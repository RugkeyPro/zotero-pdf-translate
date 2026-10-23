import { getPref, setPref } from "../../utils/prefs";
export interface Provider {
  endpoint: string;
  key: string;
}
let provider: Provider | undefined;
export async function getProvider(): Promise<Provider> {
  if (provider) return provider;
  const Services = ztoolkit.getGlobal("Services");
  const endpoint = String(getPref("agent.endpoint") || "");
  const stored = Services.logins.findLogins(
    "chrome://zoteropdftranslate-agent",
    null,
    "CPA",
  )[0];
  if (endpoint && stored) {
    provider = { endpoint, key: stored.password };
    return provider;
  }
  try {
    const home = Services.dirsvc.get(
      "Home",
      ztoolkit.getGlobal("Components").interfaces.nsIFile,
    ).path;
    const config = await ztoolkit
      .getGlobal("IOUtils")
      .readJSON(`${home}/.pi/agent/models.json`);
    const cpa = config.providers?.["cpa-server"];
    if (
      typeof cpa?.apiKey === "string" &&
      cpa.apiKey &&
      !cpa.apiKey.startsWith("!")
    ) {
      provider = { endpoint: cpa.baseUrl.replace(/\/$/, ""), key: cpa.apiKey };
      return provider;
    }
  } catch {
    /* Manual connection is available. */
  }
  throw new Error("请在连接设置中配置 CPA 接口和密钥");
}
export async function configureProvider(endpoint: string, key: string) {
  const normalized = endpoint.trim().replace(/\/$/, "");
  if (
    !/^https:\/\//i.test(normalized) &&
    !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(normalized)
  )
    throw new Error("接口需要 HTTPS，或本机 localhost 地址");
  const secret = key.trim() || (await getProvider()).key;
  const Services = ztoolkit.getGlobal("Services");
  const login = ztoolkit
    .getGlobal("Components")
    .classes[
      "@mozilla.org/login-manager/loginInfo;1"
    ].createInstance(ztoolkit.getGlobal("Components").interfaces.nsILoginInfo);
  login.init(
    "chrome://zoteropdftranslate-agent",
    null,
    "CPA",
    "CPA",
    secret,
    "",
    "",
  );
  const old = Services.logins.findLogins(
    "chrome://zoteropdftranslate-agent",
    null,
    "CPA",
  )[0];
  if (old) Services.logins.modifyLogin(old, login);
  else await Services.logins.addLoginAsync(login);
  setPref("agent.endpoint", normalized);
  provider = { endpoint: normalized, key: secret };
}
export async function listModels() {
  const p = await getProvider();
  const response = await Zotero.HTTP.request("GET", `${p.endpoint}/models`, {
    headers: { Authorization: `Bearer ${p.key}` },
    responseType: "json",
    timeout: 25000,
  });
  const data = response.response?.data;
  if (!Array.isArray(data)) throw new Error("CPA 模型列表格式无效");
  const models = [
    ...new Set(
      data
        .map((m: any) => m?.id)
        .filter(
          (id: unknown): id is string =>
            typeof id === "string" && !!id && !/(image|tts|speech)/i.test(id),
        ),
    ),
  ];
  if (!models.length) throw new Error("CPA 未提供可用的文本模型");
  return models;
}
export class SSEDecoder {
  private pending = "";
  push(text: string, final = false): any[] {
    this.pending += text;
    const events: any[] = [];
    let at: number;
    while ((at = this.pending.search(/\r?\n\r?\n/)) >= 0) {
      const frame = this.pending.slice(0, at);
      const match = this.pending.slice(at).match(/^\r?\n\r?\n/)![0];
      this.pending = this.pending.slice(at + match.length);
      this.parse(frame, events);
    }
    if (final && this.pending.trim()) {
      this.parse(this.pending, events);
      this.pending = "";
    }
    return events;
  }
  private parse(frame: string, events: any[]) {
    const data = frame
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") return;
    events.push(JSON.parse(data));
  }
}
export async function streamChat(
  messages: any[],
  model: string,
  options: {
    signal: AbortSignal;
    onText: (text: string) => void;
    tools?: any[];
    final?: boolean;
  },
) {
  const p = await getProvider();
  if (options.signal.aborted) throw new Error("已停止");
  const decoder = new SSEDecoder();
  let offset = 0;
  let content = "";
  const calls = new Map<number, any>();
  let parseError: unknown;
  let receivedResponse = false;
  const accept = (event: any) => {
    if (event.error) throw new Error("CPA 返回模型错误，请尝试其他模型");
    const delta = event.choices?.[0]?.delta;
    if (!delta) return;
    if (typeof delta.content === "string") {
      content += delta.content;
      options.onText(delta.content);
    }
    for (const t of delta.tool_calls || []) {
      const c = calls.get(t.index) || {
        id: "",
        type: "function",
        function: { name: "", arguments: "" },
      };
      if (t.id) c.id = t.id;
      if (t.function?.name) c.function.name = t.function.name;
      c.function.arguments += t.function?.arguments || "";
      calls.set(t.index, c);
    }
  };
  const consume = (text: string, final = false) => {
    for (const event of decoder.push(text, final)) accept(event);
  };
  let xhr: XMLHttpRequest | undefined;
  const abort = () => xhr?.abort();
  options.signal.addEventListener("abort", abort, { once: true });
  try {
    const response = await Zotero.HTTP.request(
      "POST",
      `${p.endpoint}/chat/completions`,
      {
        headers: {
          Authorization: `Bearer ${p.key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages,
          stream: true,
          ...(options.tools?.length ? { tools: options.tools } : {}),
          ...(options.final ? { tool_choice: "none" } : {}),
        }),
        responseType: "text",
        timeout: 180000,
        requestObserver: (request: XMLHttpRequest) => {
          xhr = request;
          if (options.signal.aborted) {
            abort();
            return;
          }
          request.onprogress = () => {
            if (request.status && request.status !== 200) return;
            try {
              const text = request.responseText;
              consume(text.slice(offset));
              offset = text.length;
            } catch (e) {
              parseError = e;
              abort();
            }
          };
        },
      },
    );
    receivedResponse = true;
    if (response.responseText.trimStart().startsWith("{")) {
      const body = JSON.parse(response.responseText);
      accept({
        ...body,
        choices: body.choices?.map((choice: any) => ({
          delta: choice.message || choice.delta,
        })),
      });
    } else consume(response.responseText.slice(offset), true);
    if (!content && !calls.size)
      throw new Error("模型没有返回正文，请切换模型重试");
    return { content, tool_calls: [...calls.values()] };
  } catch (error) {
    if (options.signal.aborted) throw new Error("已停止");
    if (parseError) throw parseError;
    if (receivedResponse)
      throw new Error((error as Error).message || "CPA 返回了无法识别的回答");
    const status = (error as any)?.status;
    throw new Error(
      status
        ? `CPA 请求失败（HTTP ${status}），请检查连接或切换模型`
        : "CPA 请求未完成，请检查网络或稍后重试",
    );
  } finally {
    options.signal.removeEventListener("abort", abort);
  }
}
