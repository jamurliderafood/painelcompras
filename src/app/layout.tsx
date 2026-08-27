import type { ReactNode } from 'react';
import './globais.css';

export const metadata = {
  title: 'Radar Flow — Lidera',
  description: 'O que piorou hoje na carteira',
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <header>
          <a href="/"><strong>Radar Flow</strong></a>
          <span className="sub">Lidera · o que piorou hoje</span>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
