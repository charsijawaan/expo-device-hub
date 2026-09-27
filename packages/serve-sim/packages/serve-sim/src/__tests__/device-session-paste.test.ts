import { describe, expect, test } from "bun:test";
import { DeviceSession } from "../device-session";
import { HID_USAGE_BY_CODE } from "../client/utils/hid";

const ControlLeft = HID_USAGE_BY_CODE.ControlLeft!;
const MetaLeft = HID_USAGE_BY_CODE.MetaLeft!;
const KeyV = HID_USAGE_BY_CODE.KeyV!;
const KeyC = HID_USAGE_BY_CODE.KeyC!;

type KeyCall = [type: "down" | "up", usage: number];

// Only the fields the paste chord touches; the rest of the session needs a real simulator.
function session(failOn?: (call: KeyCall) => boolean, udid = "SESSION-TEST") {
  const calls: KeyCall[] = [];
  const s = Object.create(DeviceSession.prototype) as DeviceSession;
  const hid = {
    inputUnavailable: false,
    async key(type: "down" | "up", usage: number) {
      if (failOn?.([type, usage])) throw new Error("HID failed");
      calls.push([type, usage]);
    },
  };
  Object.assign(s, {
    udid,
    phase: "running",
    hidSockets: new Set<object>(),
    admittedHidSockets: new Set<object>(),
    detachedHidSockets: new WeakSet<object>(),
    overloadedHidSockets: new WeakSet<object>(),
    inputOperationQueues: new Map(),
    scheduledInputSockets: new Set<object>(),
    inputSocketOrder: [],
    inputStateWaiters: new Set(),
    inputQueueDraining: false,
    restoreHardwareKeyboardWhenIdle: false,
    activeHidKeyUsages: new WeakMap<object, Set<number>>(),
    activeHidKeyUsageCounts: new Map<number, number>(),
    hid,
  });
  const internals = s as unknown as {
    hidSockets: Set<object>;
    activeHidKeyUsages: WeakMap<object, Set<number>>;
    activeHidKeyUsageCounts: Map<number, number>;
    updateHidKey(ws: object, type: "down" | "up", usage: number): Promise<void>;
    sendPasteShortcut(ws: object): Promise<void>;
    sendCommandShortcut(code: "KeyV" | "KeyC", ws: object | null): Promise<void>;
    queueInputOperation(ws: object, run: () => Promise<void>): Promise<void> | null;
  };
  const viewer = () => {
    const ws = {};
    internals.hidSockets.add(ws);
    internals.activeHidKeyUsages.set(ws, new Set());
    return ws;
  };
  return { calls, hid, internals, viewer };
}

describe("sendPasteShortcut", () => {
  test("lifts a modifier another viewer holds and keeps its owner", async () => {
    const { calls, internals, viewer } = session();
    const a = viewer();
    const b = viewer();
    await internals.updateHidKey(a, "down", ControlLeft);
    calls.length = 0;

    await internals.sendPasteShortcut(b);

    expect(calls).toEqual([
      ["up", ControlLeft],
      ["down", MetaLeft],
      ["down", KeyV],
      ["up", KeyV],
      ["up", MetaLeft],
      ["down", ControlLeft],
    ]);
    expect(internals.activeHidKeyUsageCounts.get(ControlLeft)).toBe(1);
    expect(internals.activeHidKeyUsages.get(a)?.has(ControlLeft)).toBe(true);
    expect(internals.activeHidKeyUsages.get(b)?.size).toBe(0);

    // A's later release still reaches the simulator.
    calls.length = 0;
    await internals.updateHidKey(a, "up", ControlLeft);
    expect(calls).toEqual([["up", ControlLeft]]);
  });

  test("lifts a modifier two viewers share", async () => {
    const { calls, internals, viewer } = session();
    const a = viewer();
    const b = viewer();
    await internals.updateHidKey(a, "down", ControlLeft);
    await internals.updateHidKey(b, "down", ControlLeft);
    calls.length = 0;

    await internals.sendPasteShortcut(b);

    expect(calls[0]).toEqual(["up", ControlLeft]);
    expect(calls.at(-1)).toEqual(["down", ControlLeft]);
    expect(internals.activeHidKeyUsageCounts.get(ControlLeft)).toBe(2);
  });

  test("uses another viewer's Command instead of pressing it again", async () => {
    const { calls, internals, viewer } = session();
    const a = viewer();
    const b = viewer();
    await internals.updateHidKey(a, "down", MetaLeft);
    calls.length = 0;

    await internals.sendPasteShortcut(b);

    expect(calls).toEqual([
      ["down", KeyV],
      ["up", KeyV],
    ]);
  });

  test("taps V again when another viewer holds it, without typing another v", async () => {
    const { calls, internals, viewer } = session();
    const a = viewer();
    const b = viewer();
    await internals.updateHidKey(a, "down", KeyV);
    calls.length = 0;

    await internals.sendPasteShortcut(b);

    expect(calls).toEqual([
      ["up", KeyV],
      ["down", MetaLeft],
      ["down", KeyV],
      ["up", KeyV],
      ["up", MetaLeft],
    ]);
    expect(internals.activeHidKeyUsageCounts.get(KeyV)).toBe(1);
    expect(internals.activeHidKeyUsages.get(a)?.has(KeyV)).toBe(true);
    expect(internals.activeHidKeyUsages.get(b)?.has(KeyV)).toBe(false);

    // A's next press reaches the simulator, and so does its release.
    calls.length = 0;
    await internals.updateHidKey(a, "down", KeyV);
    await internals.updateHidKey(a, "up", KeyV);
    expect(calls).toEqual([["down", KeyV], ["up", KeyV]]);
  });

  test("releases the viewer's Command when the chord fails", async () => {
    const { calls, internals, viewer } = session(([type, usage]) => type === "down" && usage === KeyV);
    const b = viewer();

    await expect(internals.sendPasteShortcut(b)).rejects.toThrow("HID failed");

    expect(calls).toEqual([
      ["down", MetaLeft],
      ["up", MetaLeft],
    ]);
    expect(internals.activeHidKeyUsages.get(b)?.size).toBe(0);
    expect(internals.activeHidKeyUsageCounts.has(MetaLeft)).toBe(false);

    // The viewer's next key is a plain key, not a Command shortcut.
    calls.length = 0;
    await internals.updateHidKey(b, "down", KeyC);
    expect(calls).toEqual([["down", KeyC]]);
    expect(internals.activeHidKeyUsageCounts.has(MetaLeft)).toBe(false);
  });

  test("puts a lifted modifier back when the chord fails", async () => {
    const { calls, internals, viewer } = session(([type, usage]) => type === "down" && usage === KeyV);
    const a = viewer();
    const b = viewer();
    await internals.updateHidKey(a, "down", ControlLeft);
    calls.length = 0;

    await expect(internals.sendPasteShortcut(b)).rejects.toThrow("HID failed");

    expect(calls.at(-1)).toEqual(["down", ControlLeft]);
    expect(internals.activeHidKeyUsageCounts.get(ControlLeft)).toBe(1);
  });
});
