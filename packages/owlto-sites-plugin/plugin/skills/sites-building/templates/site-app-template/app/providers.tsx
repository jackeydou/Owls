'use client'

import { SWRConfig } from 'swr'
import { fetchJson } from '../lib/request'

export function Providers({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <SWRConfig
      value={{
        fetcher: fetchJson,
        dedupingInterval: 10_000,
        keepPreviousData: true,
        revalidateOnFocus: false,
        shouldRetryOnError: false
      }}
    >
      {children}
    </SWRConfig>
  )
}
