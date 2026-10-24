import { type ReactNode } from "react";
import {
  FluentProvider,
  webDarkTheme,
  webLightTheme,
} from "@fluentui/react-components";

import { useSystemDarkMode } from "../shared/hooks/useSystemDarkMode";

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
      theme={darkMode ? webDarkTheme : webLightTheme}
    >
      {children}
    </FluentProvider>
  );
}
