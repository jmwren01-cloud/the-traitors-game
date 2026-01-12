// src/ws/router.ts

// NOTE: For MVP scaffold we keep ws typed loosely to avoid ESM/type-resolution issues.
// We'll tighten types later once the server is running.

export type ClientMessage = {
  type: string;
  payload?: unknown;
};

export type SendFn = (ws: any, msg: unknown) => void;
export type HandlerFn = (ws: any, msg: ClientMessage) => void;

export interface RouterDeps {
  send: SendFn;
  handlers: Record<string, HandlerFn>;
}

export function createRouter(deps: RouterDeps) {
  const { send, handlers } = deps;

  function onMessage(ws: any, raw: any) {
    let parsed: unknown;

    try {
      const text = raw.toString();
      parsed = JSON.parse(text);
    } catch {
      send(ws, {
        type: 'S2C_ERROR',
        payload: { code: 'BAD_JSON', message: 'Message must be valid JSON.' },
      });
      return;
    }

    if (!isClientMessage(parsed)) {
      send(ws, {
        type: 'S2C_ERROR',
        payload: { code: 'BAD_MESSAGE', message: 'Expected { type, payload }.' },
      });
      return;
    }

    const handler = handlers[parsed.type];
    if (!handler) {
      send(ws, {
        type: 'S2C_ERROR',
        payload: {
          code: 'UNKNOWN_EVENT',
          message: `No handler for type: ${parsed.type}`,
        },
      });
      return;
    }

    handler(ws, parsed);
  }

  return { onMessage };
}

function isClientMessage(x: unknown): x is ClientMessage {
  if (typeof x !== 'object' || x === null) return false;
  const obj = x as Record<string, unknown>;
  return typeof obj.type === 'string';
}
