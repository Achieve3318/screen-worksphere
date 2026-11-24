import { AntdRegistry } from '@ant-design/nextjs-registry'
import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { brand } from '@screenvault/shared/brand'
import { Providers } from '../components/Providers'
import './globals.css'

export const metadata: Metadata = {
  title: `${brand.productName} Admin`,
  description: 'Organization console for visible screenshot monitoring.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <AntdRegistry>
          <Providers>{children}</Providers>
        </AntdRegistry>
      </body>
    </html>
  )
}
