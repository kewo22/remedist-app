import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { cormorant, manrope, plexMono } from './fonts';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'The Remedist',
    template: '%s | The Remedist',
  },
  description: 'The Remedist clinic: book a session, manage your appointments and payments.',
};

export const viewport: Viewport = {
  themeColor: '#f7f5ee',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={cn(manrope.variable, cormorant.variable, plexMono.variable)}>
      <body className="min-h-dvh">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
