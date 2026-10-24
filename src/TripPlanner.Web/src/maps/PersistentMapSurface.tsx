import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

// Move the same map DOM into fullscreen; changing a portal's target would remount it.
export default function PersistentMapSurface({
  host,
  children,
}: {
  host?: HTMLElement | null;
  children: ReactNode;
}) {
  const inlineHost = useRef<HTMLDivElement>(null);
  const [surface] = useState(() => {
    const element = document.createElement("div");
    element.className = "activity-map-shell";
    return element;
  });
  useLayoutEffect(() => {
    (host ?? inlineHost.current)?.append(surface);
    return () => surface.remove();
  }, [host, surface]);
  return (
    <>
      <div ref={inlineHost} style={{ display: "contents" }} />
      {createPortal(children, surface)}
    </>
  );
}
