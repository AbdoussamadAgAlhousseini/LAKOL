import type { ReactNode } from "react";
import "./globals.css";

// La balise <html> est rendue par app/[locale]/layout.tsx (langue dynamique).
export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}
