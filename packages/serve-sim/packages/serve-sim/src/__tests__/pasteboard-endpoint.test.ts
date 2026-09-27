import { afterAll, describe, expect, spyOn, test } from "bun:test";
import { simMiddleware } from "../middleware";
import { useTempStateDir } from "./helpers";

const TEST_TOKEN = "test-token";
// Reads consult launch state, so keep a local serve-sim session's state out of it.
const stateDir = useTempStateDir();
afterAll(() => stateDir.restore());
const ALLOWED_CORS_ORIGIN = "https://tools.example.com";
const middleware = simMiddleware({
  basePath: "/preview",
  execToken: TEST_TOKEN,
  corsOrigins: [ALLOWED_CORS_ORIGIN],
});
const PREVIEW_ORIGIN = "http://localhost:3200";
const OTHER_ORIGIN = "https://other.example.com";

function pasteboardRequest(
  query = "",
  method = "POST",
  body?: BodyInit,
  origin: string | null = PREVIEW_ORIGIN,
): Request {
  return new Request(`http://localhost:3200/preview/api/pasteboard${query}`, {
    method,
    headers: {
      Authorization: `Bearer ${TEST_TOKEN}`,
      ...(origin === null ? {} : { Origin: origin }),
    },
    ...(body === undefined ? {} : { body }),
  });
}

describe("/api/pasteboard", () => {
  test("rejects unsupported methods", async () => {
    const res = await middleware(pasteboardRequest("", "GET"));
    expect(res?.status).toBe(405);
    expect(res?.headers.get("access-control-allow-origin")).toBe(PREVIEW_ORIGIN);
  });

  test("rejects a request with no Origin, even with the token", async () => {
    for (const method of ["POST", "PUT"]) {
      const res = await middleware(pasteboardRequest("", method, method === "PUT" ? "{}" : undefined, null));
      expect(res?.status).toBe(403);
      expect(await res!.json()).toEqual({
        ok: false,
        error: "This origin cannot use the simulator clipboard",
      });
    }
  });

  test("rejects an origin CORS does not allow, even with the token", async () => {
    for (const origin of [OTHER_ORIGIN, "null", "file://localhost"]) {
      const res = await middleware(pasteboardRequest("", "POST", undefined, origin));
      expect(res?.status).toBe(403);
      expect(res?.headers.get("access-control-allow-origin")).toBeNull();
    }
  });

  test("accepts a --cors-origin site like the other routes", async () => {
    const res = await middleware(
      pasteboardRequest("?device=not-a-udid", "POST", undefined, ALLOWED_CORS_ORIGIN),
    );
    // Past the origin check, the malformed device ID answers.
    expect(res?.status).toBe(400);
    expect(res?.headers.get("access-control-allow-origin")).toBe(ALLOWED_CORS_ORIGIN);
  });

  test("answers the preflight only for an allowed origin", async () => {
    const preflight = (origin: string) =>
      middleware(
        new Request("http://localhost:3200/preview/api/pasteboard", {
          method: "OPTIONS",
          headers: {
            Origin: origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization",
          },
        }),
      );
    expect((await preflight(ALLOWED_CORS_ORIGIN))?.headers.get("access-control-allow-origin"))
      .toBe(ALLOWED_CORS_ORIGIN);
    expect((await preflight(OTHER_ORIGIN))?.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("requires the preview token", async () => {
    const res = await middleware(
      new Request("http://localhost:3200/preview/api/pasteboard", {
        method: "POST",
        headers: { Origin: PREVIEW_ORIGIN },
      }),
    );
    expect(res?.status).toBe(401);
    expect(res?.headers.get("access-control-allow-origin")).toBe(PREVIEW_ORIGIN);
  });

  test("rejects a malformed device udid", async () => {
    const res = await middleware(pasteboardRequest("?device=not-a-udid"));
    expect(res?.status).toBe(400);
    expect(res?.headers.get("access-control-allow-origin")).toBe(PREVIEW_ORIGIN);
    const body = (await res!.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("Invalid simulator device ID");
  });

  test("returns JSON when the pasteboard read fails", async () => {
    const unavailableUdid = "00000000-0000-0000-0000-000000000000";
    const log = spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await middleware(pasteboardRequest(`?device=${unavailableUdid}`));
      expect(res?.status).toBe(500);
      expect(res?.headers.get("access-control-allow-origin")).toBe(PREVIEW_ORIGIN);
      const body = (await res!.json()) as { ok: boolean; error: string };
      expect(body).toEqual({ ok: false, error: "Could not access the simulator pasteboard" });
      expect(log).toHaveBeenCalledTimes(1);
    } finally {
      log.mockRestore();
    }
  });

  test("rejects invalid JSON before writing", async () => {
    const unavailableUdid = "00000000-0000-0000-0000-000000000000";
    const res = await middleware(
      pasteboardRequest(`?device=${unavailableUdid}`, "PUT", "{"),
    );
    expect(res?.status).toBe(400);
    expect(await res!.json()).toEqual({ ok: false, error: "Invalid JSON" });
  });

  test("rejects a body that is not an object with text", async () => {
    const unavailableUdid = "00000000-0000-0000-0000-000000000000";
    for (const body of ["null", "\"text\"", "{\"text\":1}"]) {
      const res = await middleware(pasteboardRequest(`?device=${unavailableUdid}`, "PUT", body));
      expect(res?.status).toBe(400);
      expect(await res!.json()).toEqual({ ok: false, error: "Clipboard text must be a string" });
    }
  });
});
