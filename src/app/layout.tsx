export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import "./globals.css";
import { ReadingProvider } from "@/components/navigation";
export const metadata: Metadata = {
  title: "SafeObra • Controle da sua obra",
  description: "Custos, equipe e acompanhamento em um só lugar.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <ReadingProvider>{children}</ReadingProvider>
      </body>
    </html>
  );
}
