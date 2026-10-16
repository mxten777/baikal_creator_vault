import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/useAuth'

const ASSET_CREATED_EVENT_TYPE = 'asset_created'
const ASSET_BUCKET = 'creator-assets'
const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024
const SIGNED_URL_TTL_SECONDS = 60
const PASSPORT_PUBLIC_NOTICE = '공개 링크를 아는 사람은 로그인 없이 저장된 Statement·License와 Asset 이름·유형·등록 시각을 볼 수 있습니다. 원본 관계(derived_from)는 최대 1개가 제공되며, 원본 Passport가 공개 상태이면 원본 Asset 이름과 공개 식별자가, 비공개이면 비공개 표시만 제공됩니다. 프로젝트 이름과 Timeline은 공개되지 않습니다.'
const PASSPORT_FILE_NOTICE = '원본 파일은 비공개로 유지되며 Passport 공개 링크로 열거나 다운로드할 수 없습니다. 소유자가 Download로 발급한 별도 다운로드 링크는 60초간 유효하므로 공유에 주의해 주세요.'

function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file'
  const sanitized = base.replace(/[^a-zA-Z0-9._-]/g, '_')
  return sanitized === '' || sanitized === '.' || sanitized === '..' ? 'file' : sanitized
}

type Project = {
  id: string
  name: string
}

type Asset = {
  id: string
  name: string
  asset_type: string
  storage_path: string | null
  created_at: string
}

type CreationEvent = {
  id: string
  asset_id: string
  event_type: string
  created_at: string
}

type AssetRelation = {
  id: string
  from_asset_id: string
  to_asset_id: string
  relation_type: string
  created_at: string
}

type PassportData = {
  statement: string | null
  license: string | null
}

type Passport = {
  id: string
  asset_id: string
  public_id: string
  is_public: boolean
  published_at: string | null
  data: PassportData
  updated_at: string
}

const DERIVED_FROM_RELATION_TYPE = 'derived_from'

type GraphNode = Asset & {
  level: number
  row: number
}

type GraphEdge = {
  id: string
  sourceAssetId: string
  derivedAssetId: string
}

function AssetGraph({ assets, relations }: { assets: Asset[]; relations: AssetRelation[] }) {
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]))
  const graphEdges: GraphEdge[] = relations
    .filter(
      (relation) =>
        relation.relation_type === DERIVED_FROM_RELATION_TYPE &&
        assetsById.has(relation.from_asset_id) &&
        assetsById.has(relation.to_asset_id),
    )
    .map((relation) => ({
      id: relation.id,
      // DB: from_asset_id is the derived asset and to_asset_id is its source.
      sourceAssetId: relation.to_asset_id,
      derivedAssetId: relation.from_asset_id,
    }))

  if (assets.length === 0) {
    return <p className="mt-4 text-neutral-600">No assets yet.</p>
  }

  if (graphEdges.length === 0) {
    return <p className="mt-4 text-neutral-600">No relations yet. Create a relation to build the provenance graph.</p>
  }

  const childrenBySource = new Map<string, string[]>()
  const incomingEdgeCount = new Map(assets.map((asset) => [asset.id, 0]))
  for (const edge of graphEdges) {
    childrenBySource.set(edge.sourceAssetId, [...(childrenBySource.get(edge.sourceAssetId) ?? []), edge.derivedAssetId])
    incomingEdgeCount.set(edge.derivedAssetId, (incomingEdgeCount.get(edge.derivedAssetId) ?? 0) + 1)
  }

  const levelsByAssetId = new Map<string, number>()
  const queue = assets.filter((asset) => incomingEdgeCount.get(asset.id) === 0)
  let queueIndex = 0

  // Kahn traversal terminates even when malformed data contains a provenance cycle.
  while (queueIndex < queue.length) {
    const asset = queue[queueIndex]
    queueIndex += 1
    const level = levelsByAssetId.get(asset.id) ?? 0
    levelsByAssetId.set(asset.id, level)

    for (const childId of childrenBySource.get(asset.id) ?? []) {
      levelsByAssetId.set(childId, Math.max(levelsByAssetId.get(childId) ?? 0, level + 1))
      const remainingIncomingEdges = (incomingEdgeCount.get(childId) ?? 1) - 1
      incomingEdgeCount.set(childId, remainingIncomingEdges)
      if (remainingIncomingEdges === 0) {
        queue.push(assetsById.get(childId)!)
      }
    }
  }

  const cycleDetected = levelsByAssetId.size < assets.length
  const cycleLevel = Math.max(0, ...levelsByAssetId.values()) + 1
  for (const asset of assets) {
    if (!levelsByAssetId.has(asset.id)) levelsByAssetId.set(asset.id, cycleLevel)
  }

  const nodesByLevel = new Map<number, Asset[]>()
  for (const asset of assets) {
    const level = levelsByAssetId.get(asset.id) ?? 0
    nodesByLevel.set(level, [...(nodesByLevel.get(level) ?? []), asset])
  }

  const graphNodes: GraphNode[] = []
  for (const [level, levelAssets] of nodesByLevel) {
    levelAssets.forEach((asset, row) => graphNodes.push({ ...asset, level, row }))
  }

  const nodeWidth = 180
  const nodeHeight = 68
  const horizontalGap = 44
  const verticalGap = 78
  const widestLevel = Math.max(...Array.from(nodesByLevel.values(), (levelAssets) => levelAssets.length))
  const graphWidth = Math.max(640, widestLevel * nodeWidth + (widestLevel - 1) * horizontalGap + 64)
  const graphHeight = Math.max(260, (nodesByLevel.size - 1) * (nodeHeight + verticalGap) + nodeHeight + 64)
  const nodePosition = (node: GraphNode) => {
    const nodesInLevel = nodesByLevel.get(node.level) ?? []
    const levelWidth = nodesInLevel.length * nodeWidth + (nodesInLevel.length - 1) * horizontalGap
    return {
      left: (graphWidth - levelWidth) / 2 + node.row * (nodeWidth + horizontalGap),
      top: 32 + node.level * (nodeHeight + verticalGap),
    }
  }
  const graphNodesById = new Map(graphNodes.map((node) => [node.id, node]))
  const connectedAssetIds = new Set(graphEdges.flatMap((edge) => [edge.sourceAssetId, edge.derivedAssetId]))
  const unconnectedAssets = assets.filter((asset) => !connectedAssetIds.has(asset.id))

  return (
    <>
      {cycleDetected && <p className="mt-4 text-sm text-amber-700">A provenance cycle was detected and is shown below.</p>}
      <div className="mt-4 overflow-x-auto rounded-md border border-neutral-200 bg-white">
        <div className="relative" style={{ width: graphWidth, height: graphHeight }}>
          <svg className="absolute inset-0 h-full w-full" aria-hidden="true">
            <defs>
              <marker id="asset-graph-arrow" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
                <path d="M 0 0 L 8 4 L 0 8 z" fill="currentColor" />
              </marker>
            </defs>
            {graphEdges.map((edge) => {
              const sourceNode = graphNodesById.get(edge.sourceAssetId)
              const derivedNode = graphNodesById.get(edge.derivedAssetId)
              if (!sourceNode || !derivedNode) return null
              const sourcePosition = nodePosition(sourceNode)
              const derivedPosition = nodePosition(derivedNode)
              const startX = sourcePosition.left + nodeWidth / 2
              const startY = sourcePosition.top + nodeHeight
              const endX = derivedPosition.left + nodeWidth / 2
              const endY = derivedPosition.top - 8
              const labelX = (startX + endX) / 2
              const labelY = (startY + endY) / 2
              return (
                <g key={edge.id} className="text-neutral-400">
                  <line x1={startX} y1={startY} x2={endX} y2={endY} stroke="currentColor" markerEnd="url(#asset-graph-arrow)" />
                  <text x={labelX} y={labelY - 4} textAnchor="middle" className="fill-neutral-500 text-[11px]">
                    derived from
                  </text>
                </g>
              )
            })}
          </svg>
          {graphNodes.map((node) => {
            const position = nodePosition(node)
            return (
              <div
                key={node.id}
                className="absolute rounded-md border border-neutral-300 bg-neutral-50 px-3 py-2 shadow-sm"
                style={{ width: nodeWidth, height: nodeHeight, left: position.left, top: position.top }}
              >
                <p className="truncate text-sm font-medium" title={node.name}>{node.name}</p>
                <p className="mt-1 truncate text-xs text-neutral-600" title={node.asset_type}>{node.asset_type}</p>
              </div>
            )
          })}
        </div>
      </div>
      {unconnectedAssets.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-medium text-neutral-700">Unconnected Assets</h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {unconnectedAssets.map((asset) => (
              <li key={asset.id} className="rounded-md border border-neutral-200 px-3 py-2 text-sm">
                <span className="font-medium">{asset.name}</span>
                <span className="text-neutral-600"> - {asset.asset_type}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}

// Provenance is derived on the fly from asset_relations; never copied into passport data.
function getProvenanceSummary(assetId: string, relations: AssetRelation[], assetNamesById: Map<string, string>) {
  const sources = relations
    .filter((relation) => relation.relation_type === DERIVED_FROM_RELATION_TYPE && relation.from_asset_id === assetId)
    .map((relation) => assetNamesById.get(relation.to_asset_id) ?? 'Unknown asset')
  const derivatives = relations
    .filter((relation) => relation.relation_type === DERIVED_FROM_RELATION_TYPE && relation.to_asset_id === assetId)
    .map((relation) => assetNamesById.get(relation.from_asset_id) ?? 'Unknown asset')
  return { sources, derivatives }
}

export default function ProjectWorkspacePage() {
  const { projectId } = useParams()
  const { user } = useAuth()
  const [project, setProject] = useState<Project | null>(null)
  const [workspaceLoading, setWorkspaceLoading] = useState(true)
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)
  const [assets, setAssets] = useState<Asset[]>([])
  const [assetsLoading, setAssetsLoading] = useState(true)
  const [assetsError, setAssetsError] = useState<string | null>(null)
  const [timeline, setTimeline] = useState<CreationEvent[]>([])
  const [timelineLoading, setTimelineLoading] = useState(true)
  const [timelineError, setTimelineError] = useState<string | null>(null)
  const [isAddingAsset, setIsAddingAsset] = useState(false)
  const [assetName, setAssetName] = useState('')
  const [assetType, setAssetType] = useState('')
  const [assetFile, setAssetFile] = useState<File | null>(null)
  const [creatingAsset, setCreatingAsset] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [downloadPendingId, setDownloadPendingId] = useState<string | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [relations, setRelations] = useState<AssetRelation[]>([])
  const [relationsLoading, setRelationsLoading] = useState(true)
  const [relationsError, setRelationsError] = useState<string | null>(null)
  const [isAddingRelation, setIsAddingRelation] = useState(false)
  const [derivedAssetId, setDerivedAssetId] = useState('')
  const [sourceAssetId, setSourceAssetId] = useState('')
  const [creatingRelation, setCreatingRelation] = useState(false)
  const [relationCreateError, setRelationCreateError] = useState<string | null>(null)
  const [passports, setPassports] = useState<Passport[]>([])
  const [passportsLoading, setPassportsLoading] = useState(true)
  const [passportsError, setPassportsError] = useState<string | null>(null)
  const [editingPassportAssetId, setEditingPassportAssetId] = useState<string | null>(null)
  const [passportStatement, setPassportStatement] = useState('')
  const [passportLicense, setPassportLicense] = useState('')
  const [savingPassport, setSavingPassport] = useState(false)
  const [passportSaveError, setPassportSaveError] = useState<string | null>(null)
  const [savedPassportAssetId, setSavedPassportAssetId] = useState<string | null>(null)
  const [publicLinkCopy, setPublicLinkCopy] = useState<{
    publicId: string
    url: string
    copied: boolean
  } | null>(null)

  const loadAssets = useCallback(async (active = true) => {
    if (!projectId) return []

    setAssetsLoading(true)
    setAssetsError(null)

    const { data, error } = await supabase
      .from('assets')
      .select('id, name, asset_type, storage_path, created_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })

    if (!active) return []

    if (error) {
      setAssetsError(error.message)
      setAssetsLoading(false)
      return []
    }

    setAssets(data)
    setAssetsLoading(false)
    return data
  }, [projectId])

  const loadTimeline = useCallback(async (currentAssets: Asset[], active = true) => {
    setTimelineLoading(true)
    setTimelineError(null)

    if (currentAssets.length === 0) {
      if (active) {
        setTimeline([])
        setTimelineLoading(false)
      }
      return
    }

    const { data, error } = await supabase
      .from('creation_events')
      .select('id, asset_id, event_type, created_at')
      .in(
        'asset_id',
        currentAssets.map((asset) => asset.id),
      )
      .order('created_at', { ascending: false })

    if (!active) return

    if (error) {
      setTimelineError(error.message)
    } else {
      setTimeline(data)
    }

    setTimelineLoading(false)
  }, [])

  const loadRelations = useCallback(async (active = true) => {
    if (!projectId) return []

    setRelationsLoading(true)
    setRelationsError(null)

    const { data, error } = await supabase
      .from('asset_relations')
      .select('id, from_asset_id, to_asset_id, relation_type, created_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })

    if (!active) return []

    if (error) {
      setRelationsError(error.message)
      setRelationsLoading(false)
      return []
    }

    setRelations(data)
    setRelationsLoading(false)
    return data
  }, [projectId])

  const loadPassports = useCallback(async (currentAssets: Asset[], active = true) => {
    setPassportsLoading(true)
    setPassportsError(null)

    if (currentAssets.length === 0) {
      if (active) {
        setPassports([])
        setPassportsLoading(false)
      }
      return
    }

    const { data, error } = await supabase
      .from('passports')
      .select('id, asset_id, public_id, is_public, published_at, data, updated_at')
      .in(
        'asset_id',
        currentAssets.map((asset) => asset.id),
      )

    if (!active) return

    if (error) {
      setPassportsError(error.message)
    } else {
      setPassports(data)
    }

    setPassportsLoading(false)
  }, [])

  useEffect(() => {
    let active = true

    async function loadWorkspace() {
      if (!projectId) {
        setWorkspaceError('Project is not available.')
        setWorkspaceLoading(false)
        setAssetsLoading(false)
        setTimelineLoading(false)
        setRelationsLoading(false)
        setPassportsLoading(false)
        return
      }

      setWorkspaceLoading(true)
      setWorkspaceError(null)

      const { data, error } = await supabase
        .from('projects')
        .select('id, name')
        .eq('id', projectId)
        .maybeSingle()

      if (!active) return

      if (error) {
        setWorkspaceError(error.message)
        setWorkspaceLoading(false)
        setAssetsLoading(false)
        setTimelineLoading(false)
        setRelationsLoading(false)
        setPassportsLoading(false)
        return
      }

      if (!data) {
        setWorkspaceError('Project not found or not accessible.')
        setWorkspaceLoading(false)
        setAssetsLoading(false)
        setTimelineLoading(false)
        setRelationsLoading(false)
        setPassportsLoading(false)
        return
      }

      setProject(data)
      setWorkspaceLoading(false)

      const currentAssets = await loadAssets(active)
      await loadTimeline(currentAssets, active)
      await loadRelations(active)
      await loadPassports(currentAssets, active)
    }

    void loadWorkspace()

    return () => {
      active = false
    }
  }, [loadAssets, loadTimeline, loadRelations, loadPassports, projectId])

  async function refreshAssetsAndTimeline() {
    const currentAssets = await loadAssets()
    await loadTimeline(currentAssets)
    await loadPassports(currentAssets)
  }

  async function handleCreateAsset(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!projectId || !user || creatingAsset) return

    const trimmedName = assetName.trim()
    const trimmedType = assetType.trim()
    if (!trimmedName || !trimmedType || !assetFile) return

    if (trimmedName.length > 200 || trimmedType.length > 100) return
    if (assetFile.size > MAX_FILE_SIZE_BYTES) return
    if (!assetFile.name) return

    setCreatingAsset(true)
    setCreateError(null)

    // 1) asset metadata insert (id needed to build the storage path)
    const { data: newAsset, error: assetError } = await supabase
      .from('assets')
      .insert({ project_id: projectId, name: trimmedName, asset_type: trimmedType })
      .select('id')
      .single()

    if (assetError) {
      setCreateError(assetError.message)
      setCreatingAsset(false)
      return
    }

    // 2) upload the file to the private bucket
    const storagePath = `${user.id}/${projectId}/${newAsset.id}/${sanitizeFilename(assetFile.name)}`
    const { error: uploadError } = await supabase.storage
      .from(ASSET_BUCKET)
      .upload(storagePath, assetFile, { cacheControl: '3600' })

    if (uploadError) {
      // cleanup the asset row created above so no empty asset is left behind
      await supabase.from('assets').delete().eq('id', newAsset.id)
      setCreateError(`File upload failed: ${uploadError.message}`)
      setCreatingAsset(false)
      return
    }

    // 3) record the storage path on the asset row
    const { error: pathError } = await supabase
      .from('assets')
      .update({ storage_path: storagePath })
      .eq('id', newAsset.id)

    if (pathError) {
      setCreateError(
        `File was uploaded, but saving its path failed: ${pathError.message}. The uploaded file may be orphaned.`,
      )
      setCreatingAsset(false)
      return
    }

    // 4) creation event
    const { error: eventError } = await supabase.from('creation_events').insert({
      asset_id: newAsset.id,
      event_type: ASSET_CREATED_EVENT_TYPE,
      payload: {},
    })

    await refreshAssetsAndTimeline()

    if (eventError) {
      setCreateError(`Asset was created, but its creation event failed: ${eventError.message}`)
      setCreatingAsset(false)
      return
    }

    setAssetName('')
    setAssetType('')
    setAssetFile(null)
    setIsAddingAsset(false)
    setCreatingAsset(false)
  }

  async function handleOpenAssetFile(asset: Asset) {
    if (!asset.storage_path || downloadPendingId) return

    setDownloadPendingId(asset.id)
    setDownloadError(null)

    try {
      const filename = asset.storage_path.split('/').pop() ?? ''
      const { data, error } = await supabase.storage
        .from(ASSET_BUCKET)
        .createSignedUrl(asset.storage_path, SIGNED_URL_TTL_SECONDS, { download: filename })

      if (error) {
        setDownloadError(`Could not download "${asset.name}": ${error.message}`)
        return
      }

      const link = document.createElement('a')
      link.href = data.signedUrl
      link.download = filename
      link.rel = 'noopener noreferrer'
      document.body.appendChild(link)
      link.click()
      link.remove()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Please try again.'
      setDownloadError(`Could not download "${asset.name}": ${message}`)
    } finally {
      setDownloadPendingId(null)
    }
  }

  async function handleCreateRelation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!projectId || creatingRelation) return
    if (!derivedAssetId || !sourceAssetId || derivedAssetId === sourceAssetId) return

    setCreatingRelation(true)
    setRelationCreateError(null)

    const { error } = await supabase.from('asset_relations').insert({
      project_id: projectId,
      from_asset_id: derivedAssetId,
      to_asset_id: sourceAssetId,
      relation_type: DERIVED_FROM_RELATION_TYPE,
    })

    if (error) {
      if (error.code === '23505') {
        setRelationCreateError('This relation already exists.')
      } else if (error.code === '23514') {
        setRelationCreateError('An asset cannot be related to itself.')
      } else if (error.message.includes('same project')) {
        setRelationCreateError('Assets must belong to the same project.')
      } else {
        setRelationCreateError(error.message)
      }
      setCreatingRelation(false)
      return
    }

    await loadRelations()

    setDerivedAssetId('')
    setSourceAssetId('')
    setIsAddingRelation(false)
    setCreatingRelation(false)
  }

  function handleOpenPassportEditor(passport: Passport) {
    setEditingPassportAssetId(passport.asset_id)
    setPassportStatement(passport.data.statement ?? '')
    setPassportLicense(passport.data.license ?? '')
    setPassportSaveError(null)
    setSavedPassportAssetId(null)
  }

  async function handleSavePassport(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!editingPassportAssetId || savingPassport) return

    setSavingPassport(true)
    setPassportSaveError(null)
    setSavedPassportAssetId(null)

    const trimmedStatement = passportStatement.trim()
    const trimmedLicense = passportLicense.trim()

    // Passport row is guaranteed by the assets_create_passport_trigger; UPDATE only, never upsert.
    const { error } = await supabase
      .from('passports')
      .update({
        data: {
          statement: trimmedStatement === '' ? null : trimmedStatement,
          license: trimmedLicense === '' ? null : trimmedLicense,
        },
      })
      .eq('asset_id', editingPassportAssetId)

    if (error) {
      setPassportSaveError(error.message)
      setSavingPassport(false)
      return
    }

    await loadPassports(assets)

    setSavedPassportAssetId(editingPassportAssetId)
    setEditingPassportAssetId(null)
    setSavingPassport(false)
  }

  async function handleSetPassportVisibility(passport: Passport, isPublic: boolean) {
    if (isPublic && !window.confirm(
      `${PASSPORT_PUBLIC_NOTICE}\n\n${PASSPORT_FILE_NOTICE}\n\nStatement·License에 개인정보나 공개하면 안 되는 내용이 없는지 확인해 주세요. 저장된 내용으로 Passport를 공개하시겠습니까?`,
    )) return

    const { error } = await supabase
      .from('passports')
      .update({ is_public: isPublic, published_at: isPublic ? new Date().toISOString() : null })
      .eq('asset_id', passport.asset_id)
    if (error) {
      setPassportsError(error.message)
      return
    }
    await loadPassports(assets)
  }

  async function handleCopyPublicLink(publicId: string) {
    const url = `${window.location.origin}/p/${publicId}`
    setPublicLinkCopy(null)
    try {
      await navigator.clipboard.writeText(url)
      setPublicLinkCopy({ publicId, url, copied: true })
    } catch {
      setPublicLinkCopy({ publicId, url, copied: false })
    }
  }

  const assetNamesById = new Map(assets.map((asset) => [asset.id, asset.name]))
  const passportsByAssetId = new Map(passports.map((passport) => [passport.asset_id, passport]))


  return (
    <main className="min-h-full bg-neutral-50 text-neutral-900">
      <div className="mx-auto max-w-5xl px-8 py-16">
        <Link to="/projects" className="text-sm text-neutral-600 underline-offset-4 hover:underline">
          Back to Projects
        </Link>

        {workspaceLoading && <p className="mt-8 text-neutral-600">Loading workspace...</p>}
        {workspaceError && <p className="mt-8 text-red-700">{workspaceError}</p>}

        {!workspaceLoading && !workspaceError && project && (
          <>
            <div className="mt-8 flex items-center justify-between">
              <h1 className="text-3xl font-semibold tracking-tight">{project.name}</h1>
              <button
                type="button"
                onClick={() => {
                  setIsAddingAsset(true)
                  setCreateError(null)
                }}
                className="rounded-md border border-neutral-300 px-4 py-2 text-sm text-neutral-700"
              >
                Add Asset
              </button>
            </div>

            {isAddingAsset && (
              <form onSubmit={handleCreateAsset} className="mt-8 max-w-xl rounded-md border border-neutral-200 p-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="asset-name" className="text-sm font-medium text-neutral-700">
                      Asset name
                    </label>
                    <input
                      id="asset-name"
                      type="text"
                      value={assetName}
                      onChange={(event) => setAssetName(event.target.value)}
                      maxLength={200}
                      autoFocus
                      className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label htmlFor="asset-type" className="text-sm font-medium text-neutral-700">
                      Asset type
                    </label>
                    <input
                      id="asset-type"
                      type="text"
                      value={assetType}
                      onChange={(event) => setAssetType(event.target.value)}
                      maxLength={100}
                      className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label htmlFor="asset-file" className="text-sm font-medium text-neutral-700">
                      File (max 100MB)
                    </label>
                    <input
                      id="asset-file"
                      type="file"
                      onChange={(event) => setAssetFile(event.target.files?.[0] ?? null)}
                      className="mt-1 w-full text-sm text-neutral-700"
                    />
                    {assetFile && assetFile.size > MAX_FILE_SIZE_BYTES && (
                      <p className="mt-1 text-sm text-red-700">File is larger than 100MB.</p>
                    )}
                  </div>
                </div>
                {createError && <p className="mt-3 text-sm text-red-700">{createError}</p>}
                <div className="mt-4 flex gap-3">
                  <button
                    type="submit"
                    disabled={
                      creatingAsset ||
                      !assetName.trim() ||
                      !assetType.trim() ||
                      !assetFile ||
                      assetFile.size > MAX_FILE_SIZE_BYTES
                    }
                    className="rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-700 disabled:text-neutral-400"
                  >
                    {creatingAsset ? 'Uploading...' : 'Create Asset'}
                  </button>
                  <button
                    type="button"
                    disabled={creatingAsset}
                    onClick={() => {
                      setIsAddingAsset(false)
                      setAssetName('')
                      setAssetType('')
                      setAssetFile(null)
                      setCreateError(null)
                    }}
                    className="px-3 py-2 text-sm text-neutral-700 disabled:text-neutral-400"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}

            <section className="mt-12">
              <h2 className="text-xl font-medium">Assets</h2>
              <div className="mt-4">
                {assetsLoading && <p className="text-neutral-600">Loading assets...</p>}
                {assetsError && <p className="text-red-700">{assetsError}</p>}
                {!assetsLoading && !assetsError && assets.length === 0 && (
                  <p className="text-neutral-600">No assets yet.</p>
                )}
                {!assetsLoading && !assetsError && assets.length > 0 && (
                  <ul className="space-y-3">
                    {assets.map((asset) => (
                      <li key={asset.id} className="rounded-md border border-neutral-200 px-4 py-3">
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <p className="font-medium">{asset.name}</p>
                            <p className="mt-1 text-sm text-neutral-600">
                              {asset.asset_type} - Created {new Date(asset.created_at).toLocaleString()}
                            </p>
                            <p className="mt-1 text-sm text-neutral-600">
                              {asset.storage_path
                                ? `File: ${asset.storage_path.split('/').pop()}`
                                : 'No file attached'}
                            </p>
                          </div>
                          {asset.storage_path && (
                            <button
                              type="button"
                              disabled={downloadPendingId !== null}
                              onClick={() => void handleOpenAssetFile(asset)}
                              className="rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-700 disabled:text-neutral-400"
                            >
                              {downloadPendingId === asset.id ? 'Opening...' : 'Download'}
                            </button>
                          )}
                        </div>

                        <div className="mt-3 border-t border-neutral-200 pt-3">
                          <div className="flex items-center justify-between gap-4">
                            <h3 className="text-sm font-medium text-neutral-700">Passport</h3>
                            {editingPassportAssetId !== asset.id && (
                              <button
                                type="button"
                                disabled={!passportsByAssetId.has(asset.id)}
                                onClick={() => {
                                  const passport = passportsByAssetId.get(asset.id)
                                  if (passport) handleOpenPassportEditor(passport)
                                }}
                                className="text-sm text-neutral-700 underline-offset-4 hover:underline disabled:text-neutral-400"
                              >
                                Edit Passport
                              </button>
                            )}
                          </div>

                          <div className="mt-2 space-y-1 text-xs text-neutral-600">
                            <p>{PASSPORT_PUBLIC_NOTICE}</p>
                            <p>{PASSPORT_FILE_NOTICE}</p>
                          </div>
                          {passportsLoading && <p className="mt-2 text-sm text-neutral-600">Loading passport...</p>}
                          {passportsError && <p className="mt-2 text-sm text-red-700">{passportsError}</p>}
                          {!passportsLoading && !passportsError && savedPassportAssetId === asset.id && (
                            <p role="status" className="mt-2 text-sm text-green-700">Passport가 저장되었습니다.</p>
                          )}

                          {!passportsLoading && !passportsError && editingPassportAssetId !== asset.id && (
                            <div className="mt-2 text-sm text-neutral-700">
                              <p>{passportsByAssetId.get(asset.id)?.data.statement || 'No statement yet'}</p>
                              <p className="mt-1 text-neutral-600">
                                License: {passportsByAssetId.get(asset.id)?.data.license || 'Not specified'}
                              </p>
                              {passportsByAssetId.get(asset.id) && (
                                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                                  <span className={passportsByAssetId.get(asset.id)!.is_public ? 'text-green-700' : 'text-neutral-500'}>
                                    {passportsByAssetId.get(asset.id)!.is_public ? 'Public' : 'Private'}
                                  </span>
                                  <button type="button" className="underline" onClick={() => void handleSetPassportVisibility(passportsByAssetId.get(asset.id)!, !passportsByAssetId.get(asset.id)!.is_public)}>
                                    {passportsByAssetId.get(asset.id)!.is_public ? 'Unpublish' : 'Publish'}
                                  </button>
                                  {passportsByAssetId.get(asset.id)!.is_public && (
                                    <button type="button" className="underline" onClick={() => void handleCopyPublicLink(passportsByAssetId.get(asset.id)!.public_id)}>
                                      Copy Public Link
                                    </button>
                                  )}
                                </div>
                              )}
                              {passportsByAssetId.get(asset.id)?.is_public && publicLinkCopy &&
                                publicLinkCopy.publicId === passportsByAssetId.get(asset.id)?.public_id && (
                                  publicLinkCopy.copied ? (
                                    <p role="status" className="mt-2 text-xs text-green-700">
                                      링크가 복사되었습니다
                                    </p>
                                  ) : (
                                    <div className="mt-2 space-y-2 text-xs">
                                      <p role="alert" className="text-red-700">
                                        링크를 복사하지 못했습니다. 아래 URL을 선택하여 직접 복사하거나 열어 주세요.
                                      </p>
                                      <label className="block">
                                        <span className="text-neutral-600">공개 URL</span>
                                        <input
                                          type="text"
                                          readOnly
                                          value={publicLinkCopy.url}
                                          onFocus={(event) => event.currentTarget.select()}
                                          className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                                        />
                                      </label>
                                      <a
                                        href={publicLinkCopy.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-neutral-600 underline"
                                      >
                                        공개 링크 열기
                                      </a>
                                    </div>
                                  )
                                )}
                              {(() => {
                                const { sources, derivatives } = getProvenanceSummary(asset.id, relations, assetNamesById)
                                if (sources.length === 0 && derivatives.length === 0) {
                                  return <p className="mt-1 text-neutral-600">No provenance recorded yet.</p>
                                }
                                return (
                                  <p className="mt-1 text-neutral-600">
                                    {sources.length > 0 && `Derived from: ${sources.join(', ')}`}
                                    {sources.length > 0 && derivatives.length > 0 && ' · '}
                                    {derivatives.length > 0 && `Source for: ${derivatives.join(', ')}`}
                                  </p>
                                )
                              })()}
                            </div>
                          )}

                          {editingPassportAssetId === asset.id && (
                            <form onSubmit={handleSavePassport} className="mt-2 space-y-3">
                              <div>
                                <label htmlFor={`passport-statement-${asset.id}`} className="text-sm font-medium text-neutral-700">
                                  Statement
                                </label>
                                <textarea
                                  id={`passport-statement-${asset.id}`}
                                  aria-describedby={`passport-statement-help-${asset.id}`}
                                  value={passportStatement}
                                  onChange={(event) => setPassportStatement(event.target.value)}
                                  rows={3}
                                  className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                                />
                                <p id={`passport-statement-help-${asset.id}`} className="mt-1 text-xs text-neutral-600">
                                  작품의 창작 의도와 제작 과정을 적어 주세요. 예: "직접 녹음한 빗소리에 피아노 연주를 더해, 조용한 새벽의 분위기를 표현한 곡입니다."
                                </p>
                              </div>
                              <div>
                                <label htmlFor={`passport-license-${asset.id}`} className="text-sm font-medium text-neutral-700">
                                  License
                                </label>
                                <input
                                  id={`passport-license-${asset.id}`}
                                  aria-describedby={`passport-license-help-${asset.id}`}
                                  type="text"
                                  value={passportLicense}
                                  onChange={(event) => setPassportLicense(event.target.value)}
                                  placeholder="예: 모든 권리 보유. 사용 전 창작자에게 문의해 주세요."
                                  className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                                />
                                <p id={`passport-license-help-${asset.id}`} className="mt-1 text-xs text-neutral-600">
                                  다른 사람이 작품을 사용할 수 있는 조건을 적어 주세요. 예: "개인 감상만 허용하며, 재배포·상업적 이용은 사전 허락이 필요합니다." 본인이 권한을 가진 범위에서 실제 허용할 조건으로 작성해 주세요.
                                </p>
                              </div>
                              <p className="text-xs text-neutral-600">
                                저장만으로 비공개 Passport가 공개되지는 않습니다. 이미 공개 중인 Passport는 저장한 내용이 공개 링크에 바로 반영됩니다.
                              </p>
                              {passportSaveError && <p className="text-sm text-red-700">{passportSaveError}</p>}
                              <div className="flex gap-3">
                                <button
                                  type="submit"
                                  disabled={savingPassport}
                                  className="rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-700 disabled:text-neutral-400"
                                >
                                  {savingPassport ? 'Saving...' : 'Save'}
                                </button>
                                <button
                                  type="button"
                                  disabled={savingPassport}
                                  onClick={() => {
                                    setEditingPassportAssetId(null)
                                    setPassportSaveError(null)
                                  }}
                                  className="px-3 py-2 text-sm text-neutral-700 disabled:text-neutral-400"
                                >
                                  Cancel
                                </button>
                              </div>
                            </form>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {downloadError && <p className="mt-3 text-sm text-red-700">{downloadError}</p>}
              </div>
            </section>

            <section className="mt-12">
              <h2 className="text-xl font-medium">Timeline</h2>
              <div className="mt-4">
                {timelineLoading && <p className="text-neutral-600">Loading timeline...</p>}
                {timelineError && <p className="text-red-700">{timelineError}</p>}
                {!timelineLoading && !timelineError && timeline.length === 0 && (
                  <p className="text-neutral-600">No timeline events yet.</p>
                )}
                {!timelineLoading && !timelineError && timeline.length > 0 && (
                  <ol className="space-y-3">
                    {timeline.map((event) => (
                      <li key={event.id} className="rounded-md border border-neutral-200 px-4 py-3">
                        <p className="font-medium">{assetNamesById.get(event.asset_id) ?? 'Unknown asset'}</p>
                        <p className="mt-1 text-sm text-neutral-600">
                          {event.event_type} - {new Date(event.created_at).toLocaleString()}
                        </p>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </section>

            <section className="mt-12">
              <h2 className="text-xl font-medium">Graph</h2>
              {!assetsLoading && !assetsError && !relationsLoading && !relationsError && (
                <AssetGraph assets={assets} relations={relations} />
              )}
            </section>

            <section className="mt-12">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-medium">Relations</h2>
                {assets.length >= 2 && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsAddingRelation(true)
                      setRelationCreateError(null)
                    }}
                    className="rounded-md border border-neutral-300 px-4 py-2 text-sm text-neutral-700"
                  >
                    Add Relation
                  </button>
                )}
              </div>

              {assets.length < 2 && (
                <p className="mt-4 text-neutral-600">At least two assets are required to create a relation.</p>
              )}

              {isAddingRelation && assets.length >= 2 && (
                <form
                  onSubmit={handleCreateRelation}
                  className="mt-4 max-w-xl rounded-md border border-neutral-200 p-4"
                >
                  <div>
                    <label htmlFor="derived-asset" className="text-sm font-medium text-neutral-700">
                      Derived Asset
                    </label>
                    <select
                      id="derived-asset"
                      value={derivedAssetId}
                      onChange={(event) => setDerivedAssetId(event.target.value)}
                      className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                    >
                      <option value="">Select asset...</option>
                      {assets.map((asset) => (
                        <option key={asset.id} value={asset.id} disabled={asset.id === sourceAssetId}>
                          {asset.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <p className="mt-3 text-sm text-neutral-600">derived from</p>
                  <div className="mt-3">
                    <label htmlFor="source-asset" className="text-sm font-medium text-neutral-700">
                      Source Asset
                    </label>
                    <select
                      id="source-asset"
                      value={sourceAssetId}
                      onChange={(event) => setSourceAssetId(event.target.value)}
                      className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                    >
                      <option value="">Select asset...</option>
                      {assets.map((asset) => (
                        <option key={asset.id} value={asset.id} disabled={asset.id === derivedAssetId}>
                          {asset.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  {relationCreateError && <p className="mt-3 text-sm text-red-700">{relationCreateError}</p>}
                  <div className="mt-4 flex gap-3">
                    <button
                      type="submit"
                      disabled={
                        creatingRelation ||
                        !derivedAssetId ||
                        !sourceAssetId ||
                        derivedAssetId === sourceAssetId
                      }
                      className="rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-700 disabled:text-neutral-400"
                    >
                      {creatingRelation ? 'Creating...' : 'Create Relation'}
                    </button>
                    <button
                      type="button"
                      disabled={creatingRelation}
                      onClick={() => {
                        setIsAddingRelation(false)
                        setDerivedAssetId('')
                        setSourceAssetId('')
                        setRelationCreateError(null)
                      }}
                      className="px-3 py-2 text-sm text-neutral-700 disabled:text-neutral-400"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}

              <div className="mt-4">
                {relationsLoading && <p className="text-neutral-600">Loading relations...</p>}
                {relationsError && <p className="text-red-700">{relationsError}</p>}
                {!relationsLoading && !relationsError && relations.length === 0 && (
                  <p className="text-neutral-600">No relations yet.</p>
                )}
                {!relationsLoading && !relationsError && relations.length > 0 && (
                  <ul className="space-y-3">
                    {relations.map((relation) => (
                      <li key={relation.id} className="rounded-md border border-neutral-200 px-4 py-3">
                        <p className="font-medium">
                          {assetNamesById.get(relation.from_asset_id) ?? 'Unknown asset'}
                        </p>
                        <p className="mt-1 text-sm text-neutral-600">derived from</p>
                        <p className="font-medium">{assetNamesById.get(relation.to_asset_id) ?? 'Unknown asset'}</p>
                        <p className="mt-1 text-sm text-neutral-600">
                          Created {new Date(relation.created_at).toLocaleString()}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  )
}