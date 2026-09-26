import { describe, expect, test } from "bun:test";

import { applyCaptureEvent, readCapturedBodyResult, type CapturedRequest } from "../client/hooks/use-capture-stream";
import { splitUrl } from "../client/components/network-capture-requests";
import type { CaptureMeta } from "../capture/store";

const request = (id: string): CapturedRequest => ({
  id, method: "GET", url: `https://a.test/${id}`, status: 200, mimeType: null,
  requestBytes: 0, responseBytes: 0, startedAt: 0, ttfbMs: null, durationMs: null, failure: null,
});
const meta = { attachment: "capturing" } as CaptureMeta;

describe("applyCaptureEvent", () => {
  test("replaces the list on a reconnect instead of merging into it", () => {
    // r1 was cleared on the server while this viewer was disconnected; the replay holds only r2.
    let list = [request("r1"), request("r2")];
    for (const frame of [
      { type: "meta" as const, meta, initial: true as const },
      { type: "finished" as const, request: request("r2") },
    ]) list = applyCaptureEvent(list, frame);
    expect(list.map((r) => r.id)).toEqual(["r2"]);
  });

  test("keeps the list on a live meta update", () => {
    const list = [request("r1")];
    expect(applyCaptureEvent(list, { type: "meta", meta })).toBe(list);
  });

  test("drops a request the server evicted", () => {
    const list = [request("r1"), request("r2")];
    expect(applyCaptureEvent(list, { type: "evicted", id: "r1" }).map((r) => r.id)).toEqual(["r2"]);
  });
});

describe("readCapturedBodyResult", () => {
  test("tells a failed lookup apart from a request with no body", () => {
    expect(readCapturedBodyResult({ exitCode: 0, stdout: "", stderr: "" })).toEqual({ body: null });
    expect(readCapturedBodyResult({ exitCode: 1, stdout: "", stderr: "socket closed" })).toEqual({ error: "socket closed" });
    expect(readCapturedBodyResult({ exitCode: 0, stdout: "{not json", stderr: "" })).toEqual({ error: "The body could not be read." });
    expect(readCapturedBodyResult({ exitCode: 0, stdout: '{"requestBody":"a"}', stderr: "" })).toEqual({ body: { requestBody: "a" } as never });
  });
});

describe("splitUrl", () => {
  test("keeps a failed CONNECT's destination", () => {
    expect(splitUrl("api.example.com:443")).toEqual({ host: "api.example.com", path: "api.example.com:443" });
    expect(splitUrl("api.example.com:8443")).toEqual({ host: "api.example.com:8443", path: "api.example.com:8443" });
    expect(splitUrl("https://api.example.com/v1?x=1")).toEqual({ host: "api.example.com", path: "/v1?x=1" });
  });
});
