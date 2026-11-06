// Thay fetch toàn cục trong một test và ghi lại từng lời gọi; nhớ gọi restore() trong finally.
export interface FetchCall {
  readonly url: string;
  readonly init: RequestInit | undefined;
  readonly json: unknown;
}

export type FetchHandler = (url: string, init: RequestInit | undefined, index: number) => Response | Promise<Response>;

export function stubFetch(handler: FetchHandler): { calls: FetchCall[]; restore: () => void } {
  const original = globalThis.fetch;
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    let json: unknown;
    if (typeof init?.body === "string") {
      try {
        json = JSON.parse(init.body);
      } catch {
        json = undefined;
      }
    }
    calls.push({ url, init, json });
    return handler(url, init, calls.length - 1);
  }) as typeof fetch;
  return { calls, restore: () => void (globalThis.fetch = original) };
}

// Phản hồi SSE kiểu OpenRouter. Mỗi phần tử của `pieces` là một lần đọc của luồng, để thử cả trường
// hợp một sự kiện bị cắt giữa hai lần đọc.
export function sseResponse(pieces: readonly string[], init: ResponseInit = {}): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const piece of pieces) controller.enqueue(encoder.encode(piece));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" }, ...init });
}

export const sseEvent = (data: unknown): string =>
  `data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`;

// Đọc hết một Response dạng luồng thành chuỗi.
export async function readAll(res: Response): Promise<string> {
  return res.body ? await new Response(res.body).text() : "";
}
