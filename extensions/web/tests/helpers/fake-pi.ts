/** Fake `pi` + contexts for web tests. Offline, no model calls, no timers. */

export interface ToolCall {
  toolCallId: string;
  params: Record<string, unknown>;
  signal: AbortSignal | undefined;
}

export interface ToolOutcome {
  content: Array<{ type: string; text?: string }>;
  details?: unknown;
}

export interface FakeTool {
  name: string;
  label?: string;
  description?: string;
  parameters?: unknown;
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal: AbortSignal | undefined,
    onUpdate: ((update: unknown) => void) | undefined,
    ctx: FakeCtx,
  ) => Promise<ToolOutcome>;
}

export interface FakeCtx {
  hasUI: boolean;
  cwd: string;
  model: string;
}

export interface FakePi {
  pi: { registerTool: (tool: FakeTool) => void };
  tools: Map<string, FakeTool>;
}

export function createFakePi(): FakePi {
  const tools = new Map<string, FakeTool>();
  return {
    pi: {
      registerTool(tool: FakeTool): void {
        tools.set(tool.name, tool);
      },
    },
    tools,
  };
}

export function createFakeCtx(): FakeCtx {
  return { hasUI: false, cwd: "/tmp/web-test", model: "test-model" };
}

export async function runTool(
  fake: FakePi,
  name: string,
  params: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<ToolOutcome> {
  const tool = fake.tools.get(name);
  if (!tool) throw new Error(`tool not registered: ${name}`);
  const updates: unknown[] = [];
  return tool.execute("call-1", params, signal, (update) => updates.push(update), createFakeCtx());
}

/** First text block of a tool outcome. */
export function outcomeText(outcome: ToolOutcome): string {
  return outcome.content.map((block) => block.text ?? "").join("\n");
}

/** Run fn with process.env keys overridden (undefined value unsets); restores afterwards. */
export async function withEnv<T>(
  vars: Record<string, string | undefined>,
  fn: () => Promise<T> | T,
): Promise<T> {
  const saved = new Map<string, string | undefined>();
  for (const key of Object.keys(vars)) {
    saved.set(key, process.env[key]);
    const value = vars[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

export interface RecordedRequest {
  url: string;
  init: RequestInit | undefined;
}

/** Fake fetch that records calls and replays canned responses by URL substring. */
export function createFakeFetch(
  routes: Array<{ match: string; status?: number; json?: unknown; text?: string }>,
): {
  run: typeof fetch;
  requests: RecordedRequest[];
} {
  const requests: RecordedRequest[] = [];
  const run = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input instanceof Request ? input.url : input);
    requests.push({ url, init });
    const route = routes.find((r) => url.includes(r.match));
    if (!route) return new Response("not found", { status: 404 });
    if (route.json !== undefined) {
      return new Response(JSON.stringify(route.json), {
        status: route.status ?? 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(route.text ?? "", {
      status: route.status ?? 200,
      headers: { "content-type": "text/html" },
    });
  }) as typeof fetch;
  return { run, requests };
}
