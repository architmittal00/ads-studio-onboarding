import type { Metadata, Viewport } from 'next';
import '@/launch-ad/globals.css';

export const metadata: Metadata = {
  title: 'Launch · Shiprocket Ads',
  description: 'Launch Meta campaigns, ad sets and catalog ads, pre-filled for Indian D2C.',
};

export const viewport: Viewport = { themeColor: '#faf5f1' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:ital,wght@0,400;0,500;0,600;0,700;0,800;1,700;1,800&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
