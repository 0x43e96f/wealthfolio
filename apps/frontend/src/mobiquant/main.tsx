import React from "react";
import ReactDOM from "react-dom/client";
import { Portfolio } from "./portfolio";
import "../globals.css";
import "./look.css";
import { followLook } from "./look";

followLook();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Portfolio />
  </React.StrictMode>,
);
