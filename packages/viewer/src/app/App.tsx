import { Route } from "@solidjs/router";
import { lazy } from "solid-js";
import { Layout } from "./components/Layout.tsx";

const Dashboard = lazy(() => import("./pages/Dashboard.tsx"));
const NodesTable = lazy(() => import("./pages/NodesTable.tsx"));
const NodeDetail = lazy(() => import("./pages/NodeDetail.tsx"));
const Graph = lazy(() => import("./pages/Graph.tsx"));
const Quarantine = lazy(() => import("./pages/Quarantine.tsx"));
const Conflicts = lazy(() => import("./pages/Conflicts.tsx"));

export function App() {
  return (
    <Route path="/" component={Layout}>
      <Route path="/" component={Dashboard} />
      <Route path="/table" component={NodesTable} />
      <Route path="/node/:id" component={NodeDetail} />
      <Route path="/graph" component={Graph} />
      <Route path="/quarantine" component={Quarantine} />
      <Route path="/conflicts" component={Conflicts} />
    </Route>
  );
}
