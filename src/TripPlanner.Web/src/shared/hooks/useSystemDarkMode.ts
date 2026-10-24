import { useEffect, useState } from "react";

const darkModeQuery = "(prefers-color-scheme: dark)";
export function useSystemDarkMode() {
  const [darkMode, setDarkMode] = useState(
    () => window.matchMedia?.(darkModeQuery).matches ?? false,
  );
  useEffect(() => {
    const preference = window.matchMedia?.(darkModeQuery);
    if (!preference) return;
    const update = (event: MediaQueryListEvent) => setDarkMode(event.matches);
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);
  return darkMode;
}
