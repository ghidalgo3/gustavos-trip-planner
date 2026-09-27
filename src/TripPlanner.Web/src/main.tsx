import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import App from "./App";
import ColorSchemeProvider from "./ColorSchemeProvider";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ColorSchemeProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ColorSchemeProvider>
  </StrictMode>,
);
