import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "@fontsource-variable/archivo/standard.css";
import "./styles/index.css";
import { reloadForNewVersion } from "./utils/staleChunk";

// Vite reports a failed chunk load (e.g. elkjs, html-to-image) after a deploy.
// The error still propagates to the caller; lazy views wait for the reload.
window.addEventListener("vite:preloadError", () => {
  reloadForNewVersion();
});

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
