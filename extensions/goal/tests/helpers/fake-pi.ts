/** Fake `pi` + contexts for goal-mode tests. Offline, no model calls, no timers. */

export interface FakeCommand {
  description?: string;
  handler: (args: string, ctx: any) => Promise<void>;
}

export interface FakeTool {
  name: string;
  defaultActive?: boolean;
  execute: (toolCallId: string, params: any, ...rest: any[]) => Promise<any>;
  [key: string]: any;
}

export interface SentMessage {
  content: unknown;
  options?: unknown;
}

export interface AppendedEntry {
  customType: string;
  data?: unknown;
}

export interface FakeCtxOptions {
  entries?: unknown[];
  tokens?: number | null;
  hasUI?: boolean;
  confirmResult?: boolean;
  activeTools?: string[];
}

export interface FakePi {
  pi: any;
  commands: Map<string, FakeCommand>;
  tools: Map<string, FakeTool>;
  handlers: Map<string, (event: any, ctx: any) => unknown>;
  sentUserMessages: SentMessage[];
  appendedEntries: AppendedEntry[];
  activeTools: string[];
}

interface Notification {
  message: string;
  type?: string;
}

export function createFakePi(): FakePi {
  const commands = new Map<string, FakeCommand>();
  const tools = new Map<string, FakeTool>();
  const handlers = new Map<string, (event: any, ctx: any) => unknown>();
  const sentUserMessages: SentMessage[] = [];
  const appendedEntries: AppendedEntry[] = [];
  let activeTools: string[] = ["read", "bash"];
  const pi = {
    registerCommand: (name: string, options: FakeCommand) => {
      commands.set(name, options);
    },
    registerTool: (tool: FakeTool) => {
      tools.set(tool.name, tool);
      if (tool.defaultActive !== false) {
        activeTools = [...activeTools, tool.name];
      }
    },
    on: (event: string, handler: (event: any, ctx: any) => unknown) => {
      handlers.set(event, handler);
    },
    sendUserMessage: (content: unknown, options?: unknown) => {
      sentUserMessages.push({ content, options });
    },
    appendEntry: (customType: string, data?: unknown) => {
      appendedEntries.push({ customType, data });
    },
    getActiveTools: () => [...activeTools],
    setActiveTools: (names: string[]) => {
      activeTools = [...names];
    },
  };
  return {
    pi,
    commands,
    tools,
    handlers,
    sentUserMessages,
    appendedEntries,
    get activeTools() {
      return activeTools;
    },
    set activeTools(names: string[]) {
      activeTools = names;
    },
  };
}

export function createFakeCtx(opts: FakeCtxOptions = {}): any {
  const notifications: Notification[] = [];
  const activeTools = opts.activeTools ?? ["read", "bash"];
  const tokens = opts.tokens;
  const ctx: any = {
    notifications,
    hasUI: opts.hasUI ?? true,
    ui: {
      notify: (message: string, type?: string) => {
        notifications.push({ message, type });
      },
      confirm: async (_title: string, _message: string) => opts.confirmResult ?? true,
    },
    sessionManager: {
      getEntries: () => [...(opts.entries ?? [])],
    },
    getActiveTools: () => [...activeTools],
    getContextUsage: () =>
      tokens === undefined ? undefined : { tokens, contextWindow: 200000, percent: null },
  };
  return ctx;
}

export function lastNotification(ctx: any): string {
  const notes = ctx.notifications as Notification[];
  const last = notes[notes.length - 1];
  return last === undefined ? "" : last.message;
}

/** Fire a registered event handler like Pi would (awaits async handlers). */
export async function fire(fake: FakePi, event: string, payload: any, ctx: any): Promise<unknown> {
  const handler = fake.handlers.get(event);
  if (handler === undefined) throw new Error(`no handler for ${event}`);
  return await handler(payload, ctx);
}

export async function runCommand(
  fake: FakePi,
  name: string,
  args: string,
  ctx: any,
): Promise<void> {
  const command = fake.commands.get(name);
  if (command === undefined) throw new Error(`no command ${name}`);
  await command.handler(args, ctx);
}

/** Run fn with process.env keys overridden (undefined value unsets); restores afterwards. */
export async function withEnv<T>(
  vars: Record<string, string | undefined>,
  fn: () => Promise<T> | T,
): Promise<T> {
  const prev = new Map<string, string | undefined>();
  for (const key of Object.keys(vars)) {
    prev.set(key, process.env[key]);
    const v = vars[key];
    if (v === undefined) delete process.env[key];
    else process.env[key] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of prev) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
