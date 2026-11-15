import { expect, test, vi } from "vitest";
import type { MapCamera, MapHandle } from "./IMapsClient";
import {
  DestinationFlight,
  destinationCamera,
  destinationFlightFrame,
} from "./destinationFlight";

const viewport = { width: 800, height: 400 };
const from: MapCamera = { center: [139.76, 35.68], zoom: 11 };
const to: MapCamera = { center: [-0.12, 51.5], zoom: 11 };

test("pans and zooms together throughout the flight", () => {
  expect(destinationFlightFrame(from, to, viewport, 0)).toEqual(from);
  const departing = destinationFlightFrame(from, to, viewport, 0.125);
  expect(departing.center).not.toEqual(from.center);
  expect(departing.center).not.toEqual(to.center);
  expect(departing.zoom).toBeLessThan(from.zoom);
  const travelling = destinationFlightFrame(from, to, viewport, 0.5);
  expect(travelling.center).not.toEqual(from.center);
  expect(travelling.center).not.toEqual(to.center);
  expect(travelling.zoom).toBeLessThan(from.zoom);
  const arriving = destinationFlightFrame(from, to, viewport, 0.875);
  expect(arriving.center).not.toEqual(to.center);
  expect(arriving.center).not.toEqual(from.center);
  expect(arriving.zoom).toBeLessThan(to.zoom);
  expect(destinationFlightFrame(from, to, viewport, 1)).toEqual(to);
});

test.each([
  { width: 800, height: 400 },
  { width: 400, height: 800 },
])(
  "the widest view fits both endpoints and their view footprints (%j)",
  (size) => {
    // Points on the equator have a linear Mercator X coordinate, allowing an
    // independent check that both complete endpoint views fit the midpoint.
    const start: MapCamera = { center: [0, 0], zoom: 11 };
    const end: MapCamera = { center: [6, 0], zoom: 9 };
    const middle = destinationFlightFrame(start, end, size, 0.5);
    const halfWorldWidth = size.width / (1024 * 2 ** middle.zoom);
    for (const endpoint of [start, end]) {
      const offset = Math.abs(endpoint.center[0] - middle.center[0]) / 360;
      const endpointHalfWidth = size.width / (1024 * 2 ** endpoint.zoom);
      expect(offset + endpointHalfWidth).toBeLessThanOrEqual(
        halfWorldWidth + 1e-12,
      );
    }
    expect(middle.zoom).toBeGreaterThan(4);
  },
);

test("nearby destinations need only a small zoom change, and wider viewports need less zoom-out", () => {
  const start: MapCamera = { center: [0, 0], zoom: 11 };
  const near: MapCamera = { center: [0.001, 0], zoom: 11 };
  const far: MapCamera = { center: [6, 0], zoom: 11 };
  const nearby = destinationFlightFrame(start, near, viewport, 0.5);
  expect(nearby.zoom).toBeGreaterThan(10.9);
  expect(nearby.zoom).toBeLessThan(11);
  const wide = destinationFlightFrame(start, far, viewport, 0.5);
  const narrow = destinationFlightFrame(
    start,
    far,
    { width: 400, height: 800 },
    0.5,
  );
  expect(wide.zoom).toBeGreaterThan(narrow.zoom);
  expect(narrow.zoom).toBeGreaterThan(0);
});

test("identical views do not introduce an unnecessary zoom excursion", () => {
  const middle = destinationFlightFrame(from, from, viewport, 0.5);
  expect(middle.center[0]).toBeCloseTo(from.center[0]);
  expect(middle.center[1]).toBeCloseTo(from.center[1]);
  expect(middle.zoom).toBe(from.zoom);
});

test("uses sine ease-in-out for the full camera transition", () => {
  const progress = 0.25;
  const frame = destinationFlightFrame(from, to, viewport, progress);
  const eased = (1 - Math.cos(Math.PI * progress)) / 2;
  expect(frame.center[0]).toBeCloseTo(
    from.center[0] + (to.center[0] - from.center[0]) * eased,
  );
});

test("framing and flight paths cross the dateline by the short route", () => {
  const target = destinationCamera(
    [
      [179, 20],
      [-179, 22],
    ],
    viewport,
    11,
  );
  expect(Math.abs(target.center[0])).toBeCloseTo(180);
  expect(target.zoom).toBeGreaterThan(5);
  const halfway = destinationFlightFrame(
    { center: [179, 20], zoom: 11 },
    { center: [-179, 22], zoom: 11 },
    viewport,
    0.5,
  );
  expect(Math.abs(halfway.center[0])).toBeCloseTo(180);
});

function animation() {
  let camera = from;
  let now = 0;
  let id = 0;
  let size = viewport;
  const callbacks = new Map<number, FrameRequestCallback>();
  const map = {
    getCamera: () => camera,
    setCamera: vi.fn((next: MapCamera) => {
      camera = next;
    }),
    stop: vi.fn(),
  } as unknown as MapHandle;
  const flight = new DestinationFlight(map, () => size, {
    now: () => now,
    request: (callback) => {
      callbacks.set(++id, callback);
      return id;
    },
    cancel: (id) => {
      callbacks.delete(id);
    },
  });
  return {
    map,
    flight,
    camera: () => camera,
    hidden: () => {
      size = { width: 0, height: 0 };
    },
    advance: (time: number) => {
      now = time;
      const pending = [...callbacks.values()];
      callbacks.clear();
      pending.forEach((callback) => callback(time));
    },
    pending: () => callbacks.size,
  };
}

test("a transition lasts 1.5 seconds and late pins do not restart its clock", () => {
  const duration = 1500;
  const run = animation();
  run.flight.start([to.center], 11);
  run.advance(duration / 2);
  expect(run.flight.active).toBe(true);
  run.flight.retarget([to.center, [0.5, 52]], 11);
  run.advance(duration);
  expect(run.flight.active).toBe(false);
  expect(run.pending()).toBe(0);
  expect(run.camera()).toMatchObject(
    destinationCamera([to.center, [0.5, 52]], viewport, 11),
  );
});

test("rapid destination changes start from the current camera and cancel the older flight", () => {
  const run = animation();
  run.flight.start([to.center], 11);
  run.advance(750);
  const interrupted = run.camera();
  run.flight.start([[2.35, 48.86]], 11);
  expect(run.camera().center).toEqual(interrupted.center);
  expect(run.pending()).toBe(1);
  run.advance(2250);
  expect(run.camera().center[0]).toBeCloseTo(2.35);
  expect(run.camera().center[1]).toBeCloseTo(48.86);
  expect(run.flight.active).toBe(false);
});

test.each(["cancel", "hidden"] as const)(
  "%s stops scheduling intermediate camera changes",
  (action) => {
    const run = animation();
    run.flight.start([to.center], 11);
    run.advance(750);
    if (action === "hidden") {
      run.hidden();
      run.advance(900);
    } else run.flight.cancel();
    const calls = vi.mocked(run.map.setCamera).mock.calls.length;
    run.advance(2000);
    expect(run.flight.active).toBe(false);
    expect(run.pending()).toBe(0);
    expect(run.map.setCamera).toHaveBeenCalledTimes(calls);
  },
);
