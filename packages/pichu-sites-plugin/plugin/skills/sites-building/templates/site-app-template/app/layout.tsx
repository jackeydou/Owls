import type { Metadata } from 'next'
import './globals.css'
import { Providers } from './providers'

export const metadata: Metadata = {
  title: 'Sites Starter',
  description: 'A clean Next.js starter for Owls Sites builds.'
}

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="font-sans">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
