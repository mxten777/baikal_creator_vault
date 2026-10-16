import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from './useAuth'

export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()

  if (loading) {
    return <AuthLoading />
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}

export function AuthLoading() {
  return (
    <main lang="ko" className="flex min-h-full items-center justify-center bg-neutral-50">
      <p className="text-sm text-neutral-500">불러오는 중…</p>
    </main>
  )
}
