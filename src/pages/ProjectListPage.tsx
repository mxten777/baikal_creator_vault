import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/useAuth'

export default function ProjectListPage() {
  const { user } = useAuth()

  async function handleSignOut() {
    await supabase.auth.signOut()
  }

  return (
    <main className="min-h-full bg-neutral-50 text-neutral-900">
      <div className="mx-auto max-w-5xl px-8 py-16">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-semibold tracking-tight">BAIKAL Creator Vault</h1>
          <div className="flex items-center gap-4">
            <span className="text-sm text-neutral-600">{user?.email}</span>
            <button
              type="button"
              onClick={handleSignOut}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700"
            >
              Sign Out
            </button>
          </div>
        </div>

        <div className="mt-12 flex items-center justify-between">
          <h2 className="text-xl font-medium">Projects</h2>
          {/* Placeholder only — project creation is implemented in STEP 8-D. */}
          <button
            type="button"
            disabled
            className="rounded-md border border-neutral-300 px-4 py-2 text-sm text-neutral-500"
          >
            + New Project
          </button>
        </div>

        <p className="mt-8 text-neutral-600">No projects yet.</p>
      </div>
    </main>
  )
}
