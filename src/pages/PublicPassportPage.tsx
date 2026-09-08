import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

type PublicPassport = {
  passport: { statement: string | null; license: string | null }
  asset: { name: string; type: string; created_at: string }
  provenance: {
    relation_type: string
    source: { public_id: string; name: string } | { visibility: 'private' }
  } | null
}

export default function PublicPassportPage() {
  const { publicId } = useParams()
  const [passport, setPassport] = useState<PublicPassport | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    async function load() {
      if (!publicId) {
        setLoading(false)
        return
      }
      const { data, error } = await supabase.functions.invoke('get-public-passport', { body: { publicId } })
      if (active && !error) setPassport(data as PublicPassport)
      if (active) setLoading(false)
    }
    void load()
    return () => { active = false }
  }, [publicId])

  return (
    <main className="min-h-full bg-neutral-50 text-neutral-900">
      <div className="mx-auto max-w-2xl px-8 py-16">
        <Link to="/" className="text-sm text-neutral-600 underline-offset-4 hover:underline">BAIKAL Creator Vault</Link>
        {loading && <p className="mt-8 text-neutral-600">Loading passport...</p>}
        {!loading && !passport && <p className="mt-8 text-neutral-700">Passport not available</p>}
        {passport && (
          <article className="mt-8 rounded-md border border-neutral-200 bg-white p-6">
            <p className="text-sm text-neutral-500">Public Passport</p>
            <h1 className="mt-2 text-2xl font-semibold">{passport.asset.name}</h1>
            <p className="mt-1 text-sm text-neutral-600">{passport.asset.type} - Created {new Date(passport.asset.created_at).toLocaleString()}</p>
            <dl className="mt-8 space-y-5 text-sm">
              <div><dt className="font-medium text-neutral-700">Creator statement</dt><dd className="mt-1 whitespace-pre-wrap">{passport.passport.statement || 'No statement provided'}</dd></div>
              <div><dt className="font-medium text-neutral-700">License</dt><dd className="mt-1">{passport.passport.license || 'Not specified'}</dd></div>
              {passport.provenance && (
                <div>
                  <dt className="font-medium text-neutral-700">Provenance</dt>
                  <dd className="mt-1">
                    {'visibility' in passport.provenance.source
                      ? 'Source asset is private'
                      : `${passport.provenance.relation_type}: ${passport.provenance.source.name}`}
                  </dd>
                </div>
              )}
            </dl>
          </article>
        )}
      </div>
    </main>
  )
}