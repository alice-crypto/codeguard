import { vi } from "vitest";

type Handler = unknown | ((body: unknown) => unknown);

export class MockError {
  constructor(
    readonly message: string,
    readonly status = 400,
  ) {}
}

export function mockApi(routes: Record<string, Handler>) {
  const calls: Array<{ route: string; body: unknown }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init?: RequestInit) => {
      const route = `${init?.method ?? "GET"} ${path}`;
      const body: unknown = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ route, body });
      if (!(route in routes)) {
        return new Response(JSON.stringify({ error: `route non simulée : ${route}` }), {
          status: 404,
        });
      }
      const handler = routes[route];
      const result =
        typeof handler === "function" ? (handler as (b: unknown) => unknown)(body) : handler;
      if (result instanceof MockError) {
        return new Response(JSON.stringify({ error: result.message }), { status: result.status });
      }
      return new Response(JSON.stringify(result));
    }),
  );
  return calls;
}
