import { Cormorant_Garamond, IBM_Plex_Mono, Manrope } from 'next/font/google';

// Brand typefaces, self-hosted by next/font (no request to Google at runtime).
// Each exposes a CSS variable that globals.css maps to font-sans / font-display / font-mono.

export const manrope = Manrope({
  subsets: ['latin'],
  variable: '--font-manrope',
  display: 'swap',
});

export const cormorant = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['500', '600'],
  style: ['normal', 'italic'],
  variable: '--font-cormorant',
  display: 'swap',
});

export const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-plex-mono',
  display: 'swap',
});
