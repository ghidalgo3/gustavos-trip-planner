import { type ReactNode } from "react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";

import { useSystemDarkMode } from "../shared/hooks/useSystemDarkMode";
import { darkTheme } from "./theme";

export default function ColorSchemeProvider({
  children,
}: {
  children: ReactNode;
}) {
  const darkMode = useSystemDarkMode();

  return (
    <FluentProvider
      // Portals need theme tokens, not the app shell's opaque background and height.
      applyStylesToPortals={false}
      className="app-theme"
      data-color-scheme={darkMode ? "dark" : "light"}
      theme={darkMode ? darkTheme : webLightTheme}
    >
      {children}
    </FluentProvider>
  );
}
