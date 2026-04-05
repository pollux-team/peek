import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import Overlay from "./Overlay";

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
const path = window.location.pathname || "/";

if (path.startsWith("/overlay")) {
  root.render(
    <React.StrictMode>
      <Overlay />
    </React.StrictMode>
  );
} else {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
