import { useEffect, useState, type ReactNode } from "react";
import {
  FluentProvider,
  webDarkTheme,
  webLightTheme,
} from "@fluentui/react-components";

const darkModeQuery = "(prefers-color-scheme: dark)";

function browserPrefersDarkMode() {
  return window.matchMedia?.(darkModeQuery).matches ?? false;
}

export default function ColorSchemeProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [darkMode, setDarkMode] = useState(browserPrefersDarkMode);

  useEffect(() => {
    const preference = window.matchMedia?.(darkModeQuery);
    if (!preference) return;

    const updateTheme = (event: MediaQueryListEvent) =>
      setDarkMode(event.matches);
    preference.addEventListener("change", updateTheme);
    return () => preference.removeEventListener("change", updateTheme);
  }, []);

  return (
    <FluentProvider
      // Portals need theme tokens, not the app shell's opaque background and height.
      applyStylesToPortals={false}
      className="app-theme"
      data-color-scheme={darkMode ? "dark" : "light"}
      theme={darkMode ? webDarkTheme : webLightTheme}
    >
      {children}
    </FluentProvider>
  );
}
