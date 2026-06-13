import type { Metadata } from "next";
import "./globals.css";
import { AgentRuntimeProvider } from "@/realtime/AgentRuntimeContext";

export const metadata: Metadata = {
  title: "Agent Console",
  description: "Fault-tolerant real-time AI agent console"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
      </head>
      <body>
        {/* Single WebSocket connection + shared state for the entire app.
            Both / (console) and /chat read from the same runtime instance,
            so navigating between pages never loses state. */}
        <AgentRuntimeProvider>
          {children}
        </AgentRuntimeProvider>
      </body>
    </html>
  );
}
