import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  AnimatedMapMarkers,
  type MapMarkerDescription,
} from "./AnimatedMapMarkers";

const originalAnimate = HTMLElement.prototype.animate;
beforeEach(() => {
  if (!originalAnimate)
    Object.defineProperty(HTMLElement.prototype, "animate", {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
});

function description(key = "museum", longitude = 2.3): MapMarkerDescription {
  const button = document.createElement("button");
  button.textContent = "1";
  button.title = key;
  button.setAttribute("aria-label", key);
  button.onclick = vi.fn();
  return { key, position: [longitude, 48.8], button };
}

function setup() {
  const animations: {
    cancel: ReturnType<typeof vi.fn>;
    onfinish?: () => void;
  }[] = [];
  const animate = vi
    .spyOn(HTMLElement.prototype, "animate")
    .mockImplementation(() => {
      const animation = { cancel: vi.fn() };
      animations.push(animation);
      return animation as unknown as Animation;
    });
  const create = vi.fn((item: MapMarkerDescription) => item.button);
  const remove = vi.fn();
  return {
    transitions: new AnimatedMapMarkers(create, remove),
    create,
    remove,
    animate,
    animations,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  if (!originalAnimate)
    Reflect.deleteProperty(HTMLElement.prototype, "animate");
});

test("markers fade in, stay stable on selection changes, and fade out before removal", () => {
  const { transitions, create, remove, animate, animations } = setup();
  const item = description();
  transitions.update([item], false);
  expect(animate).toHaveBeenCalledWith([{ opacity: "0" }, { opacity: 1 }], {
    duration: 180,
    easing: "ease-out",
  });
  animations[0].onfinish?.();
  const selected = description();
  selected.button.dataset.selected = "true";
  transitions.update([selected], false);
  expect(create).toHaveBeenCalledTimes(1);
  expect(animate).toHaveBeenCalledTimes(1);
  expect(item.button).toHaveAttribute("data-selected", "true");
  transitions.update([], false);
  expect(item.button).toBeDisabled();
  expect(item.button).toHaveAttribute("aria-hidden", "true");
  expect(item.button.onclick).toBeNull();
  expect(remove).not.toHaveBeenCalled();
  animations[1].onfinish?.();
  expect(remove).toHaveBeenCalledWith(item.button);
});

test("quickly restoring results cancels their exit without duplicates or stale removals", () => {
  const { transitions, create, remove, animations } = setup();
  const item = description();
  transitions.update([item], false);
  transitions.update([], false);
  transitions.update([description()], false);
  expect(animations[1].cancel).toHaveBeenCalled();
  animations[1].onfinish?.();
  expect(remove).not.toHaveBeenCalled();
  expect(create).toHaveBeenCalledTimes(1);
  expect(item.button).not.toBeDisabled();
  expect(item.button).not.toHaveAttribute("aria-hidden");
});

test("selection updates preserve SDK positioning classes and transforms on every bubble", () => {
  const create = vi.fn((item: MapMarkerDescription) => {
    item.button.classList.add(
      "maplibregl-marker",
      "maplibregl-marker-anchor-bottom",
    );
    item.button.style.transform =
      "translate(-50%, -100%) translate(200px, 100px)";
    return item.button;
  });
  const transitions = new AnimatedMapMarkers(create, vi.fn());
  const items = [
    description("museum"),
    description("park"),
    description("stay"),
  ];
  items.forEach(
    (item) => (item.button.className = "activity-map-marker previous-state"),
  );
  transitions.update(items, true);
  const updated = items.map((item, index) => {
    const next = description(item.key);
    next.button.className = "activity-map-marker";
    if (index === 0) next.button.dataset.selected = "true";
    return next;
  });
  transitions.update(updated, true);
  expect(create).toHaveBeenCalledTimes(3);
  for (const item of items) {
    expect(item.button).toHaveClass(
      "activity-map-marker",
      "maplibregl-marker",
      "maplibregl-marker-anchor-bottom",
    );
    expect(item.button).not.toHaveClass("previous-state");
    expect(item.button.style.transform).toBe(
      "translate(-50%, -100%) translate(200px, 100px)",
    );
  }
  expect(items[0].button).toHaveAttribute("data-selected", "true");
});

test("moving a pin crossfades locations and disposal cancels all pending removals", () => {
  const { transitions, create, remove, animations } = setup();
  transitions.update([description()], false);
  transitions.update([description("museum", 2.4)], false);
  expect(create).toHaveBeenCalledTimes(2);
  expect(remove).not.toHaveBeenCalled();
  transitions.dispose();
  expect(remove).toHaveBeenCalledTimes(2);
  animations.forEach((animation) => animation.onfinish?.());
  expect(remove).toHaveBeenCalledTimes(2);
});

test.each([true, false])(
  "reduced motion removes markers immediately, including in-flight fades (initial=%s)",
  (initial) => {
    const { transitions, remove, animate } = setup();
    transitions.update([description()], initial);
    if (initial) expect(animate).not.toHaveBeenCalled();
    transitions.update([], true);
    expect(remove).toHaveBeenCalledTimes(1);
  },
);
