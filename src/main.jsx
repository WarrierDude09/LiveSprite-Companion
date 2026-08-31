import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/app.css";
import "./styles/studio.css";
import "./styles/audio.css";
import "./styles/renderer.css";
import "./styles/hotkeys.css";
import "./styles/streaming.css";
import "./styles/calibration.css";
import "./styles/animations.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
