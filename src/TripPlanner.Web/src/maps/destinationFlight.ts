import type { MapCamera, MapHandle } from "./IMapsClient";

const flightDuration = 1500;
type Position = [number, number];
export type FlightViewport = { width: number; height: number };

function project([longitude, latitude]: Position): Position {
  const radians =
    (Math.max(-85.051129, Math.min(85.051129, latitude)) * Math.PI) / 180;
  return [
    (longitude + 180) / 360,
    (1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2,
  ];
}
function unproject([x, y]: Position): Position {
  return [
    ((((x * 360) % 360) + 360) % 360) - 180,
    (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI,
  ];
}
const mix = (from: number, to: number, progress: number) =>
  from + (to - from) * progress;

// Azure's vector map uses a 512-pixel world at zoom zero. Fit in Mercator space
// and unwrap longitudes around the first point so dateline crossings stay short.
export function destinationCamera(
  points: Position[],
  viewport: FlightViewport,
  maxZoom: number,
): MapCamera {
  const projected = points.map(project);
  const anchor = projected[0][0];
  const xs = projected.map(([x]) => x + Math.round(anchor - x));
  const ys = projected.map(([, y]) => y);
  const west = Math.min(...xs),
    east = Math.max(...xs);
  const north = Math.min(...ys),
    south = Math.max(...ys);
  const scale = Math.min(
    Math.max(1, viewport.width - 96) / (512 * (east - west)),
    Math.max(1, viewport.height - 96) / (512 * (south - north)),
  );
  return {
    center: unproject([(west + east) / 2, (north + south) / 2]),
    zoom: Math.max(0, Math.min(maxZoom, Math.log2(scale))),
  };
}

export function destinationFlightFrame(
  from: MapCamera,
  to: MapCamera,
  viewport: FlightViewport,
  progress: number,
): MapCamera {
  const start = project(from.center),
    end = project(to.center);
  end[0] += Math.round(start[0] - end[0]);
  const p = Math.max(0, Math.min(1, progress));
  if (p === 0) return from;
  if (p === 1) return to;
  const pan = (1 - Math.cos(Math.PI * p)) / 2;
  const startScale = 2 ** -from.zoom;
  const endScale = 2 ** -to.zoom;
  // At the flight's midpoint, fit both endpoint view footprints using the
  // viewport's actual aspect ratio, rather than always backing out to the world.
  const overviewScale = Math.min(
    1,
    Math.max(startScale, endScale) +
      Math.max(
        (Math.abs(end[0] - start[0]) * 512) / Math.max(1, viewport.width),
        (Math.abs(end[1] - start[1]) * 512) / Math.max(1, viewport.height),
      ),
  );
  // Interpolate ground scale, not zoom levels, so widening the view happens
  // quickly enough to keep the endpoints in context while the camera pans.
  const scale = mix(
    pan < 0.5 ? startScale : endScale,
    overviewScale,
    Math.sin(Math.PI * pan),
  );
  return {
    center: unproject([mix(start[0], end[0], pan), mix(start[1], end[1], pan)]),
    zoom: Math.max(0, -Math.log2(scale)),
  };
}

type FrameClock = {
  now: () => number;
  request: (callback: FrameRequestCallback) => number;
  cancel: (id: number) => void;
};
const browserClock: FrameClock = {
  now: () => performance.now(),
  request: (callback) => window.requestAnimationFrame(callback),
  cancel: (id) => window.cancelAnimationFrame(id),
};

export class DestinationFlight {
  private frame?: number;
  private target?: MapCamera;
  private size: FlightViewport;

  constructor(
    private map: MapHandle,
    private viewport: () => FlightViewport,
    private clock: FrameClock = browserClock,
  ) {
    this.size = viewport();
  }

  get active() {
    return this.target !== undefined;
  }

  retarget(points: Position[], maxZoom: number) {
    const size = this.viewport();
    if (size.width > 0 && size.height > 0) this.size = size;
    this.target = destinationCamera(points, this.size, maxZoom);
  }

  start(points: Position[], maxZoom: number) {
    this.cancel();
    this.map.stop();
    const from = this.map.getCamera();
    const started = this.clock.now();
    this.retarget(points, maxZoom);
    const tick = (now: number) => {
      if (!this.target) return;
      const size = this.viewport();
      if (size.width <= 0 || size.height <= 0) {
        this.map.setCamera({ ...this.target, type: "jump", duration: 0 });
        this.cancel();
        return;
      }
      const progress = Math.min(1, (now - started) / flightDuration);
      this.map.setCamera({
        ...destinationFlightFrame(from, this.target, this.size, progress),
        type: "jump",
        duration: 0,
      });
      if (progress < 1) this.frame = this.clock.request(tick);
      else {
        this.frame = undefined;
        this.target = undefined;
      }
    };
    tick(started);
  }

  cancel() {
    if (this.frame !== undefined) this.clock.cancel(this.frame);
    this.frame = undefined;
    this.target = undefined;
  }
}
