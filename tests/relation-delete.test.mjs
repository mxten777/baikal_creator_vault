import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../src/pages/ProjectWorkspacePage.tsx', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText

const assets = ['derived', 'source', 'other'].map((id) => ({
  id, name: `${id} asset`, asset_type: 'audio', storage_path: null, created_at: '2026-10-18',
}))
const relations = [
  { id: 'relation-1', from_asset_id: 'derived', to_asset_id: 'source', relation_type: 'derived_from', created_at: '2026-10-18' },
  { id: 'relation-2', from_asset_id: 'other', to_asset_id: 'source', relation_type: 'derived_from', created_at: '2026-10-18' },
]
const settle = () => new Promise((resolve) => setImmediate(resolve))

// Exercise the actual page handlers and JSX with in-memory hooks and a deny-by-default API.
async function mount(options = {}) {
  const slots = []
  const effects = []
  const calls = []
  const confirmations = []
  let cursor = 0
  let serverRelations = options.relations ?? [...relations]
  let deleted = false
  const react = {
    useState(initial) {
      const index = cursor++
      if (!(index in slots)) slots[index] = initial
      return [slots[index], (value) => {
        slots[index] = typeof value === 'function' ? value(slots[index]) : value
      }]
    },
    useRef(initial) {
      const index = cursor++
      if (!(index in slots)) slots[index] = { current: initial }
      return slots[index]
    },
    useCallback: (callback) => callback,
    useEffect: (effect) => effects.push(effect),
  }
  const supabase = {
    from(table) {
      let deleting = false
      const filters = {}
      const query = {
        select(columns) {
          if (deleting) calls.push({ table, operation: 'delete', filters: { ...filters }, columns })
          return query
        },
        delete() { deleting = true; return query },
        eq(key, value) { filters[key] = value; return query },
        in() { return query },
        order() { return query },
        maybeSingle() { return query },
        async then(resolve, reject) {
          try {
            if (deleting) {
              assert.equal(table, 'asset_relations', 'Only relations may be deleted')
              const result = await (options.deleteResult?.() ?? { data: [{ id: 'relation-1' }], error: null })
              if (!result.error && result.data?.some((row) => row.id === filters.id)) {
                serverRelations = serverRelations.filter((row) => row.id !== filters.id)
                deleted = true
              }
              return resolve(result)
            }
            calls.push({ table, operation: 'select' })
            const data = {
              projects: { id: 'project-1', name: 'Pilot' },
              assets: options.assets ?? assets,
              asset_relations: serverRelations,
              passports: [],
              creation_events: [],
            }
            assert.ok(table in data, `Unexpected table: ${table}`)
            return resolve(table === 'asset_relations' && deleted && options.refreshError
              ? { data: null, error: { message: 'refresh failed' } }
              : { data: data[table], error: null })
          } catch (error) {
            return reject(error)
          }
        },
      }
      return query
    },
  }
  const module = { exports: {} }
  const jsx = (type, props) => ({ type, props })
  const mocks = {
    react,
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'fragment' },
    'react-router-dom': { Link: 'a', useParams: () => ({ projectId: 'project-1' }) },
    '../lib/supabase': { supabase },
    '../auth/useAuth': { useAuth: () => ({ user: { id: 'user-1' } }) },
  }
  vm.runInNewContext(compiled, {
    exports: module.exports,
    require(name) {
      assert.ok(name in mocks, `Unexpected dependency: ${name}`)
      return mocks[name]
    },
    window: { confirm(message) { confirmations.push(message); return options.confirm !== false } },
    Error, Map, Set, Date,
  })
  function render() {
    cursor = 0
    return module.exports.default()
  }
  render()
  effects[0]()
  await settle()
  function nodes(node) {
    if (node == null || typeof node === 'boolean') return []
    if (Array.isArray(node)) return node.flatMap((child) => nodes(child))
    if (typeof node !== 'object') return [node]
    if (typeof node.type === 'function') return nodes(node.type(node.props))
    return [node, ...nodes(node.props?.children ?? null)]
  }
  const text = (node = render()) => nodes(node).filter((value) => typeof value === 'string').join(' ')
  const buttons = () => nodes(render()).filter((node) => node.type === 'button' && /관계 삭제|삭제 중/.test(text(node)))
  return {
    calls, confirmations, nodes: () => nodes(render()), text, buttons,
    click: (index = 0) => buttons()[index].props.onClick(),
    deletions: () => calls.filter((call) => call.operation === 'delete'),
  }
}

test('cancel shows both asset names and sends no deletion', async () => {
  const page = await mount({ confirm: false })
  page.click()
  await settle()
  assert.match(page.confirmations[0], /파생 에셋: derived asset/)
  assert.match(page.confirmations[0], /원본 에셋: source asset/)
  assert.match(page.confirmations[0], /에셋·파일·패스포트·작업 기록은 유지/)
  assert.equal(page.deletions().length, 0)
  assert.equal(page.buttons().length, 2)
})

test('confirmed deletion is scoped, verifies returned ID, and refreshes list and graph', async () => {
  const page = await mount()
  assert.equal(page.nodes().filter((node) => node.type === 'line').length, 2)
  page.click()
  await settle()
  assert.deepEqual(page.deletions(), [{
    table: 'asset_relations', operation: 'delete',
    filters: { id: 'relation-1', project_id: 'project-1', relation_type: 'derived_from' },
    columns: 'id',
  }])
  assert.equal(page.calls.filter((call) => call.table === 'asset_relations' && call.operation === 'select').length, 2)
  assert.equal(page.buttons().length, 1)
  assert.equal(page.nodes().filter((node) => node.type === 'line').length, 1)
  assert.equal(page.nodes().filter((node) => node.type === 'h3' && page.text(node) === '패스포트').length, 3)
  assert.ok(page.buttons()[0].props.className.includes('max-sm:min-h-11'))
  assert.equal(page.calls.filter((call) => call.operation !== 'select' && call.table !== 'asset_relations').length, 0)
})

test('pending deletion blocks same-tick double clicks and disables all delete buttons', async () => {
  let finish
  const pending = new Promise((resolve) => { finish = resolve })
  const page = await mount({ deleteResult: () => pending })
  const click = page.buttons()[0].props.onClick
  click()
  click()
  await settle()
  assert.equal(page.deletions().length, 1)
  assert.equal(page.confirmations.length, 1)
  assert.ok(page.buttons().every((button) => button.props.disabled))
  assert.equal(page.text(page.buttons()[0]), '삭제 중…')
  finish({ data: [{ id: 'relation-1' }], error: null })
  await settle()
  assert.equal(page.buttons()[0].props.disabled, false)
})

test('deleting the last relation shows empty list and graph guidance without removing assets', async () => {
  const page = await mount({ relations: [relations[0]] })
  page.click()
  await settle()
  assert.equal(page.buttons().length, 0)
  assert.equal(page.nodes().filter((node) => node.type === 'line').length, 0)
  assert.match(page.text(), /아직 원본·파생 관계가 없습니다/)
  assert.equal(page.nodes().filter((node) => node.type === 'h3' && page.text(node) === '패스포트').length, 3)
})

for (const [name, result, message] of [
  ['RLS/API error', { data: null, error: { message: 'permission denied' } }, /permission denied/],
  ['zero deleted rows', { data: [], error: null }, /삭제 권한/],
  ['missing response', { data: null, error: null }, /삭제된 관계를 확인하지 못/],
  ['wrong returned ID', { data: [{ id: 'unexpected' }], error: null }, /삭제된 관계를 확인하지 못/],
  ['unexpected multiple rows', { data: [{ id: 'relation-1' }, { id: 'relation-2' }], error: null }, /삭제된 관계를 확인하지 못/],
]) {
  test(`${name} is visible and does not remove local relations`, async () => {
    const page = await mount({ deleteResult: () => result })
    page.click()
    await settle()
    assert.equal(page.buttons().length, 2)
    assert.match(page.text(page.nodes().find((node) => node.props?.role === 'alert')), message)
    assert.ok(page.buttons().every((button) => !button.props.disabled))
    assert.equal(page.calls.filter((call) => call.table === 'asset_relations' && call.operation === 'select').length, 1)
  })
}

test('network exception releases lock and reports uncertain outcome', async () => {
  const page = await mount({ deleteResult: () => { throw new Error('offline') } })
  page.click()
  await settle()
  assert.match(page.text(page.nodes().find((node) => node.props?.role === 'alert')), /삭제 결과를 확인하지 못.*offline/)
  assert.ok(page.buttons().every((button) => !button.props.disabled))
  page.click()
  await settle()
  assert.equal(page.deletions().length, 2)
})

test('refresh failure is visible after confirmed deletion without restoring the removed relation', async () => {
  const page = await mount({ refreshError: true })
  page.click()
  await settle()
  assert.match(page.text(), /refresh failed/)
  assert.doesNotMatch(page.text(), /삭제된 관계를 확인하지 못/)
})

test('other relation types have no delete action', async () => {
  const page = await mount({ relations: [{ ...relations[0], relation_type: 'references' }] })
  assert.equal(page.buttons().length, 0)
})

test('missing asset information prevents deletion and explains how to recover', async () => {
  const page = await mount({ assets: assets.filter((asset) => asset.id !== 'derived') })
  page.click()
  await settle()
  assert.equal(page.confirmations.length, 0)
  assert.equal(page.deletions().length, 0)
  assert.match(page.text(page.nodes().find((node) => node.props?.role === 'alert')), /에셋 정보를 확인할 수 없/)
})
