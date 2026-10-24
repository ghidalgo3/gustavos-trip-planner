import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import App from "./app/App";
import ColorSchemeProvider from "./app/ColorSchemeProvider";
import "./styles.css";
import { initializeTelemetry } from "./telemetry/telemetry";

await initializeTelemetry();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ColorSchemeProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ColorSchemeProvider>
  </StrictMode>,
);
