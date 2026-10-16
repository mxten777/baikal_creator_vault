import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/useAuth'

type Project = {
  id: string
  name: string
  created_at: string
}

export default function ProjectListPage() {
  const { user } = useAuth()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    async function loadProjects() {
      setLoading(true)
      setFetchError(null)

      const { data, error } = await supabase
        .from('projects')
        .select('id, name, created_at')
        .order('created_at', { ascending: false })

      if (!active) return

      if (error) {
        setFetchError(`프로젝트를 불러오지 못했습니다. 다시 시도해 주세요. (상세: ${error.message})`)
      } else {
        setProjects(data)
      }

      setLoading(false)
    }

    void loadProjects()

    return () => {
      active = false
    }
  }, [])

  async function handleSignOut() {
    await supabase.auth.signOut()
  }

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const trimmedName = name.trim()
    if (!trimmedName || !user || creating) return

    setCreating(true)
    setCreateError(null)

    const { data, error } = await supabase
      .from('projects')
      .insert({ name: trimmedName, owner_id: user.id })
      .select('id, name, created_at')
      .single()

    if (error) {
      setCreateError(`프로젝트를 만들지 못했습니다. 다시 시도해 주세요. (상세: ${error.message})`)
    } else {
      setProjects((currentProjects) => [data, ...currentProjects])
      setName('')
      setIsCreating(false)
    }

    setCreating(false)
  }

  return (
    <main lang="ko" className="min-h-full bg-neutral-50 text-neutral-900 [overflow-wrap:anywhere]">
      <div className="mx-auto max-w-5xl px-8 py-16">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-3xl font-semibold tracking-tight">BAIKAL Creator Vault</h1>
          <div className="flex min-w-0 flex-wrap items-center gap-4">
            <span className="text-sm text-neutral-600">{user?.email}</span>
            <button
              type="button"
              onClick={handleSignOut}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 max-sm:min-h-11 max-sm:min-w-11"
            >
              로그아웃
            </button>
          </div>
        </div>

        <div className="mt-12 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-medium">프로젝트</h2>
          <button
            type="button"
            onClick={() => {
              setIsCreating(true)
              setCreateError(null)
            }}
            className="rounded-md border border-neutral-300 px-4 py-2 text-sm text-neutral-700 max-sm:min-h-11 max-sm:min-w-11"
          >
            + 새 프로젝트
          </button>
        </div>

        {isCreating && (
          <form onSubmit={handleCreate} className="mt-8 flex max-w-md flex-wrap items-start gap-3">
            <div className="min-w-0 basis-full sm:flex-1 sm:basis-auto">
              <label htmlFor="project-name" className="sr-only">
                프로젝트 이름
              </label>
              <input
                id="project-name"
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={200}
                autoFocus
                placeholder="프로젝트 이름"
                className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
              />
              {createError && <p className="mt-2 text-sm text-red-700">{createError}</p>}
            </div>
            <button
              type="submit"
              disabled={creating || !name.trim()}
              className="rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-700 disabled:text-neutral-400 max-sm:min-h-11 max-sm:min-w-11"
            >
              {creating ? '만드는 중…' : '만들기'}
            </button>
            <button
              type="button"
              disabled={creating}
              onClick={() => {
                setIsCreating(false)
                setName('')
                setCreateError(null)
              }}
              className="px-3 py-2 text-sm text-neutral-700 disabled:text-neutral-400 max-sm:min-h-11 max-sm:min-w-11"
            >
              취소
            </button>
          </form>
        )}

        <div className="mt-8">
          {loading && <p className="text-neutral-600">프로젝트를 불러오는 중…</p>}
          {fetchError && <p className="text-red-700">{fetchError}</p>}
          {!loading && !fetchError && projects.length === 0 && (
            <p className="text-neutral-600">아직 프로젝트가 없습니다.</p>
          )}
          {!loading && !fetchError && projects.length > 0 && (
            <ul className="space-y-3">
              {projects.map((project) => (
                <li key={project.id} className="rounded-md border border-neutral-200 px-4 py-3">
                  <Link
                    to={`/projects/${project.id}`}
                    className="font-medium text-neutral-900 underline-offset-4 hover:underline"
                  >
                    {project.name}
                  </Link>
                  <p className="mt-1 text-sm text-neutral-600">
                    생성일 {new Date(project.created_at).toLocaleDateString('ko-KR')}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </main>
  )
}
