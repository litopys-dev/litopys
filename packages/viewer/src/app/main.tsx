import { Router } from "@solidjs/router";
import { render } from "solid-js/web";
import { App } from "./App.tsx";

const root = document.getElementById("root");
if (!root) throw new Error("No #root element");

render(
  () => (
    <Router>
      <App />
    </Router>
  ),
  root,
);
