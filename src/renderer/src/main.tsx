import "@fontsource-variable/inter";
import "./styles/globals.css";
import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { queryClient, startCoreConnection } from "./core/connection";

const root = document.getElementById("root");

if (!root) {
  throw new Error("index.html has no #root element");
}

startCoreConnection();

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
