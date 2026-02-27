import "./globals.css";
import React from "react";

export const metadata = {
  title: "Simulador Legislació i Deontologia Farmacèutica",
  description: "Simulador de casos de dispensació"
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ca">
      <body>
        <div className="container">
          {children}
        </div>
      </body>
    </html>
  );
}
