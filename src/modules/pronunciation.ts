// Edge Read Aloud's free online voice, with no account, key or runtime package.
// Protocol reference: https://github.com/rany2/edge-tts (LGPL-3.0).
const TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const VOICE = "en-US-EmmaMultilingualNeural";
let generation = 0;
let cancel: (() => void) | undefined;
let audio: HTMLAudioElement | undefined;
let objectURL: string | undefined;

export function stopPronunciation() {
  generation++;
  cancel?.();
  cancel = undefined;
  audio?.pause();
  audio = undefined;
  if (objectURL) Zotero.getMainWindow().URL.revokeObjectURL(objectURL);
  objectURL = undefined;
}

function requestURL() {
  const Services = ztoolkit.getGlobal("Services");
  const { classes, interfaces } = ztoolkit.getGlobal("Components");
  const hash = classes["@mozilla.org/security/hash;1"].createInstance(
    interfaces.nsICryptoHash,
  );
  const ticks = Math.floor((Date.now() / 1000 + 11644473600) / 300) * 300 * 1e7;
  const input = `${ticks}${TOKEN}`;
  hash.init(hash.SHA256);
  hash.update(
    Array.from(input, (c) => c.charCodeAt(0)),
    input.length,
  );
  const gec = Array.from(hash.finish(false) as string, (c) =>
    c.charCodeAt(0).toString(16).padStart(2, "0"),
  )
    .join("")
    .toUpperCase();
  const id = Services.uuid.generateUUID().toString().replace(/[{}-]/g, "");
  return {
    id,
    url: `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TOKEN}&ConnectionId=${id}&Sec-MS-GEC=${gec}&Sec-MS-GEC-Version=1-143.0.3650.75`,
  };
}

export async function playPronunciation(text: string) {
  stopPronunciation();
  const ticket = generation;
  // Bound a selection request, rather than silently truncating the original.
  if (!text.trim() || text.length > 6000)
    throw new Error("Select up to 6000 characters");
  const win = Zotero.getMainWindow();
  const Services = ztoolkit.getGlobal("Services");
  const ChromeUtils = ztoolkit.getGlobal("ChromeUtils");
  const { id, url } = requestURL();
  const bytes = await new Promise<Uint8Array[]>((resolve, reject) => {
    const { classes, interfaces } = ztoolkit.getGlobal("Components");
    const channel = classes[
      "@mozilla.org/network/protocol;1?name=wss"
    ].createInstance(interfaces.nsIWebSocketChannel);
    const principal = Services.scriptSecurityManager.getSystemPrincipal();
    channel.initLoadInfo(
      null,
      principal,
      principal,
      interfaces.nsILoadInfo.SEC_ALLOW_CROSS_ORIGIN_SEC_CONTEXT_IS_NULL,
      interfaces.nsIContentPolicy.TYPE_WEBSOCKET,
    );
    // Scope Edge headers to this one synthesis request only.
    const observer = {
      observe(subject: unknown) {
        const request = (
          subject as { QueryInterface(i: unknown): any }
        ).QueryInterface(interfaces.nsIHttpChannel);
        if (
          request.URI.host !== "speech.platform.bing.com" ||
          !request.URI.spec.includes(`ConnectionId=${id}`)
        )
          return;
        request.setRequestHeader(
          "User-Agent",
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0",
          false,
        );
        request.setRequestHeader(
          "Cookie",
          `muid=${Services.uuid.generateUUID().toString().replace(/[{}-]/g, "").toUpperCase()};`,
          false,
        );
      },
    };
    Services.obs.addObserver(observer, "http-on-modify-request");
    let settled = false;
    const chunks: Uint8Array[] = [];
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      Services.obs.removeObserver(observer, "http-on-modify-request");
      win.clearTimeout(timeout);
      cancel = undefined;
      try {
        channel.close(1000, "");
      } catch {
        /* Already closed. */
      }
      if (error) reject(error);
      else if (!chunks.length) reject(new Error("No speech audio returned"));
      else resolve(chunks);
    };
    const timeout = win.setTimeout(
      () => finish(new Error("Speech request timed out")),
      25000,
    );
    cancel = () => finish(new Error("Speech cancelled"));
    const escaped = text.replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&apos;",
        })[c]!,
    );
    const listener = {
      QueryInterface: ChromeUtils.generateQI(["nsIWebSocketListener"]),
      onStart() {
        const stamp = new Date().toUTCString();
        channel.sendMsg(
          `X-Timestamp:${stamp}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n${JSON.stringify(
            {
              context: {
                synthesis: {
                  audio: {
                    metadataoptions: {
                      sentenceBoundaryEnabled: "false",
                      wordBoundaryEnabled: "false",
                    },
                    outputFormat: "audio-24khz-48kbitrate-mono-mp3",
                  },
                },
              },
            },
          )}\r\n`,
        );
        channel.sendMsg(
          `X-RequestId:${id}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${stamp}Z\r\nPath:ssml\r\n\r\n<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'><voice name='${VOICE}'><prosody pitch='+0Hz' rate='+0%' volume='+0%'>${escaped}</prosody></voice></speak>`,
        );
      },
      onMessageAvailable(_context: unknown, message: string) {
        if (message.includes("Path:turn.end")) finish();
      },
      onBinaryMessageAvailable(_context: unknown, message: string) {
        if (settled || message.length < 2) return;
        const length = (message.charCodeAt(0) << 8) | message.charCodeAt(1);
        if (length + 2 > message.length) return;
        if (!message.slice(2, length + 2).includes("Path:audio")) return;
        const data = message.slice(length + 2);
        if (data.length)
          chunks.push(Uint8Array.from(data, (c) => c.charCodeAt(0)));
      },
      onStop(_context: unknown, status: number) {
        finish(new Error(`Speech connection closed (${status.toString(16)})`));
      },
      onServerClose() {
        finish(new Error("Speech service closed the connection"));
      },
      onAcknowledge() {},
      onError() {
        finish(new Error("Speech connection failed"));
      },
    };
    try {
      channel.asyncOpen(
        Services.io.newURI(url),
        "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
        {},
        0,
        listener,
        null,
      );
    } catch (error) {
      finish(error as Error);
    }
  }).catch((error) => {
    if (ticket !== generation) return undefined;
    throw error;
  });
  if (!bytes || ticket !== generation) return;
  objectURL = win.URL.createObjectURL(
    new win.Blob(bytes, { type: "audio/mpeg" }),
  );
  const player: HTMLAudioElement = new win.Audio(objectURL);
  audio = player;
  player.addEventListener(
    "ended",
    () => {
      if (ticket === generation) stopPronunciation();
    },
    { once: true },
  );
  try {
    await player.play();
  } catch (error) {
    if (ticket === generation) stopPronunciation();
    throw error;
  }
}
