import { afterEach, expect, it, vi } from "vitest";
import { ApiError, getJson, postJson } from "./client";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(response: Response | Error) {
  const mock =
    response instanceof Error
      ? vi.fn().mockRejectedValue(response)
      : vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", mock);
  return mock;
}

it("envoie l'en-tête anti-CSRF sur les écritures", async () => {
  const mock = stubFetch(new Response("{}"));
  await postJson("/api/x", { a: 1 });
  const [, init] = mock.mock.calls[0] as [string, RequestInit];
  expect(init.headers).toMatchObject({ "X-Codeguard": "1" });
  expect(init.body).toBe('{"a":1}');
});

it("reprend le message d'erreur du serveur", async () => {
  stubFetch(new Response('{"error":"analyse introuvable"}', { status: 404 }));
  await expect(getJson("/api/x")).rejects.toMatchObject({
    message: "analyse introuvable",
    status: 404,
  });
});

it("gère une réponse d'erreur non JSON", async () => {
  stubFetch(new Response("oups", { status: 500 }));
  await expect(getJson("/api/x")).rejects.toThrow("Erreur 500");
});

it("signale un serveur arrêté", async () => {
  stubFetch(new TypeError("Failed to fetch"));
  await expect(getJson("/api/x")).rejects.toBeInstanceOf(ApiError);
});
