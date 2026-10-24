import { useEffect } from "react";
import { useLocation } from "react-router";

export default function ScrollPositionRestoration() {
  const location = useLocation();
  // Destination tabs share one viewport. Ignore their query parameter when
  // remembering/restoring the page, including browser back/forward navigation.
  const search = new URLSearchParams(location.search);
  if (/^\/trips\/[^/]+\/activities\/?$/.test(location.pathname))
    search.delete("destination");
  const scrollKey = `tripplanner:scroll:${location.pathname}${search.size ? `?${search}` : ""}`;
  useEffect(() => {
    const key = scrollKey;
    const saved = Number(sessionStorage.getItem(key) ?? 0);
    let restoring = saved > 0;
    let frame = 0;
    const started = Date.now();
    function restore() {
      if (!restoring) return;
      const available =
        document.documentElement.scrollHeight - window.innerHeight;
      const flightSearch = document.getElementById("flight-search");
      if (
        available >= saved ||
        (flightSearch && saved >= flightSearch.offsetTop)
      ) {
        if (available >= saved) window.scrollTo(0, saved);
        else flightSearch?.scrollIntoView();
        restoring = false;
      } else if (Date.now() - started > 12000) {
        restoring = false;
      } else frame = window.requestAnimationFrame(restore);
    }
    if (restoring) frame = window.requestAnimationFrame(restore);
    const remember = () => {
      if (!restoring) sessionStorage.setItem(key, String(window.scrollY));
    };
    window.addEventListener("scroll", remember, { passive: true });
    window.addEventListener("pagehide", remember);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", remember);
      window.removeEventListener("pagehide", remember);
      remember();
    };
  }, [scrollKey]);
  return null;
}
