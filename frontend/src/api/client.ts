export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function parse<T>(response: Response): Promise<T> {
  const data: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = (data as { error?: string }).error;
    throw new ApiError(message ?? `Erreur ${response.status}`, response.status);
  }
  return data as T;
}

async function send(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(path, init);
  } catch {
    throw new ApiError("Le serveur codeguard ne répond plus.", 0);
  }
}

export async function getJson<T>(path: string): Promise<T> {
  return parse<T>(await send(path));
}

export async function postJson<T>(path: string, body: object = {}): Promise<T> {
  return parse<T>(
    await send(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Codeguard": "1" },
      body: JSON.stringify(body),
    }),
  );
}
