import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { UpdateBanner } from "@/components/update-banner";
import { router } from "./router";
import "./index.css";
import { initTheme } from "./lib/theme";

initTheme();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RouterProvider router={router} />
        <UpdateBanner />
      </TooltipProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
