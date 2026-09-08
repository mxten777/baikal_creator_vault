import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/useAuth'
import { AuthLoading } from '../auth/ProtectedRoute'

type Mode = 'signin' | 'signup'

export default function LoginPage() {
  const { user, loading } = useAuth()
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setNotice(null)

    if (!email.trim() || !password) {
      setError('Enter your email and password.')
      return
    }

    setSubmitting(true)
    try {
      if (mode === 'signin') {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        })
        if (signInError) {
          setError(
            signInError.message === 'Invalid login credentials'
              ? 'Incorrect email or password.'
              : 'Could not sign in. Please try again.',
          )
        }
      } else {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        })
        if (signUpError) {
          setError(signUpError.message || 'Could not create the account.')
        } else if (!data.session) {
          setNotice('Check your email to confirm your account.')
        }
      }
    } catch {
      setError('Network error. Please check your connection and try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return <AuthLoading />
  }

  if (user) {
    return <Navigate to="/projects" replace />
  }

  return (
    <main className="min-h-full bg-neutral-50 text-neutral-900">
      <div className="mx-auto max-w-sm px-8 py-24">
        <h1 className="text-2xl font-semibold tracking-tight">BAIKAL Creator Vault</h1>
        <p className="mt-2 text-sm text-neutral-600">
          {mode === 'signin' ? 'Sign in to your account' : 'Create a new account'}
        </p>

        <form className="mt-10 space-y-4" onSubmit={handleSubmit}>
          <label className="block">
            <span className="text-sm text-neutral-700">Email</span>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
            />
          </label>

          <label className="block">
            <span className="text-sm text-neutral-700">Password</span>
            <input
              type="password"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
            />
          </label>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {notice && <p className="text-sm text-neutral-700">{notice}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-60"
          >
            {mode === 'signin' ? 'Sign In' : 'Create account'}
          </button>
        </form>

        <button
          type="button"
          onClick={() => {
            setMode(mode === 'signin' ? 'signup' : 'signin')
            setError(null)
            setNotice(null)
          }}
          className="mt-6 text-sm text-neutral-600 underline"
        >
          {mode === 'signin' ? 'Create account' : 'Back to sign in'}
        </button>
      </div>
    </main>
  )
}
