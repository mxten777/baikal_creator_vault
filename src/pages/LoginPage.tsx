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
      setError('이메일과 비밀번호를 입력해 주세요.')
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
              ? '이메일 또는 비밀번호를 확인해 주세요.'
              : '로그인하지 못했습니다. 다시 시도해 주세요.',
          )
        }
      } else {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        })
        if (signUpError) {
          setError(`계정을 만들지 못했습니다. 다시 시도해 주세요.${signUpError.message ? ` (상세: ${signUpError.message})` : ''}`)
        } else if (!data.session) {
          setNotice('이메일을 확인하여 계정 인증을 완료해 주세요.')
        }
      }
    } catch {
      setError('네트워크 오류가 발생했습니다. 연결 상태를 확인한 후 다시 시도해 주세요.')
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
    <main lang="ko" className="min-h-full bg-neutral-50 text-neutral-900 [overflow-wrap:anywhere]">
      <div className="mx-auto max-w-sm px-8 py-24">
        <h1 className="text-2xl font-semibold tracking-tight">BAIKAL Creator Vault</h1>
        <p className="mt-2 text-sm text-neutral-600">
          {mode === 'signin' ? '계정에 로그인해 주세요' : '새 계정을 만들어 주세요'}
        </p>

        <form className="mt-10 space-y-4" onSubmit={handleSubmit}>
          <label className="block">
            <span className="text-sm text-neutral-700">이메일</span>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
            />
          </label>

          <label className="block">
            <span className="text-sm text-neutral-700">비밀번호</span>
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
            {mode === 'signin' ? '로그인' : '계정 만들기'}
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
          {mode === 'signin' ? '회원가입' : '로그인으로 돌아가기'}
        </button>
      </div>
    </main>
  )
}
