import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { headers } from 'next/headers';
import { cookieToInitialState } from 'wagmi';
import { Providers } from '@/providers';
import { wagmiConfig } from '@/lib/wagmi';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

// Financial figures are set in mono so columns line up and digits do not jitter.
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'upKEEP - Persistent financial conditions for Arc',
    template: '%s - upKEEP',
  },
  description:
    'A reusable financial automation layer for Arc Mainnet. Turn persistent financial conditions into permissioned onchain actions, with an architecture designed for a post-quantum future.',
  applicationName: 'upKEEP',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0e1117' },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Hydrate wagmi from the cookie so a connected wallet survives a refresh
  // without a flash of the disconnected state.
  const initialState = cookieToInitialState(wagmiConfig, (await headers()).get('cookie'));

  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="min-h-screen bg-background font-sans">
        <Providers initialState={initialState}>{children}</Providers>
      </body>
    </html>
  );
}
