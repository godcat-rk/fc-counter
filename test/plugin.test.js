// node --test test/
const test = require('node:test')
const assert = require('node:assert')
const path = require('path')

function load() {
  const p = require.resolve(path.join(__dirname, '..', 'onecomme-plugin', 'fc-counter', 'plugin.js'))
  delete require.cache[p]
  const plugin = require(p)
  const data = {}
  plugin.init({ store: { get: (k) => data[k], set: (k, v) => (data[k] = v) } }, {})
  return plugin
}

async function call(plugin, method, body) {
  const out = await plugin.request({ method, url: '', params: {}, body })
  return { code: out.code, body: JSON.parse(out.response) }
}

async function setup(counters) {
  const plugin = load()
  let s = (await call(plugin, 'GET')).body
  for (const c of s.counters) await call(plugin, 'POST', { action: 'remove', id: c.id })
  for (const c of counters) await call(plugin, 'POST', { action: 'add', counter: c })
  s = (await call(plugin, 'GET')).body
  const byName = (n) => s.counters.find((c) => c.name === n)
  return { plugin, byName, get: async () => (await call(plugin, 'GET')).body }
}

let seq = 0
// 最上位の id は枠の ID で、同じ枠のコメントでは同じ値になる。
// コメントごとに一意なのは data.id のほう（わんコメの実データで確認済み）。
const FRAME_ID = 'COMMENT_TESTER'
function comment(userId, extra = {}, dataExtra = {}) {
  seq++
  return { id: FRAME_ID, service: 'youtube', ...extra, data: { id: 'c' + seq, userId, liveId: 'L', isOwner: false, hasGift: false, comment: 'hi', ...dataExtra } }
}

// わんコメがプラグインへ渡す本物の形
function deliver(plugin, list) {
  plugin.subscribe('comments', { comments: list, userNameMap: {}, options: {} })
}

function val(s, name) {
  return s.counters.find((c) => c.name === name).value
}

test('コメント数・人数・初見を数え、同じコメントは二重に数えない', async () => {
  const t = await setup([
    { name: 'C', metric: 'comments', goal: 0 },
    { name: 'U', metric: 'commenters', goal: 0 },
    { name: 'F', metric: 'firstTimers', goal: 0 },
  ])
  const a1 = comment('a', {}, { isFirstTime: true })
  deliver(t.plugin, [a1, comment('a'), comment('b')])
  deliver(t.plugin, [a1]) // 再送
  deliver(t.plugin, [comment('owner', {}, { isOwner: true })])
  const s = await t.get()
  assert.strictEqual(val(s, 'C'), 3)
  assert.strictEqual(val(s, 'U'), 2)
  assert.strictEqual(val(s, 'F'), 1)
})

test('連投制限は時間内の発言を数えない', async () => {
  const t = await setup([{ name: 'C', metric: 'comments', goal: 0, opts: { cooldownSec: 60 } }])
  deliver(t.plugin, [comment('a'), comment('a'), comment('b')])
  assert.strictEqual(val(await t.get(), 'C'), 2)
})

test('キーワードは1人1回まで、部分一致で数える', async () => {
  const t = await setup([{ name: 'K', metric: 'keyword', goal: 0, opts: { keyword: '888', oncePerUser: true } }])
  deliver(t.plugin, [comment('a', {}, { comment: 'わー8888' }), comment('a', {}, { comment: '888' }), comment('b', {}, { comment: 'こんにちは' })])
  assert.strictEqual(val(await t.get(), 'K'), 1)
})

test('スパチャは円建てだけ合計し、メンバーはギフト件数も数える', async () => {
  const t = await setup([
    { name: 'S', metric: 'superchat', goal: 1000 },
    { name: 'M', metric: 'members', goal: 0 },
  ])
  deliver(t.plugin, [
    comment('a', {}, { hasGift: true, price: 500, currency: 'JPY', giftType: 'superchat' }),
    comment('b', {}, { hasGift: true, price: 5, currency: 'USD', giftType: 'superchat' }),
    comment('c', {}, { hasGift: true, giftType: 'subscribe' }),
    comment('d', {}, { hasGift: true, giftType: 'sponsorgift', giftCount: 5 }),
  ])
  const s = await t.get()
  assert.strictEqual(val(s, 'S'), 500)
  assert.strictEqual(val(s, 'M'), 6)
})

test('スパチャはコメントとしても数え、メンバー加入の通知は数えない', async () => {
  const t = await setup([
    { name: 'C', metric: 'comments', goal: 0 },
    { name: 'U', metric: 'commenters', goal: 0 },
  ])
  deliver(t.plugin, [
    comment('a', {}, { hasGift: true, price: 500, currency: 'JPY', giftType: 'superchat' }),
    comment('b', {}, { hasGift: true, giftType: 'subscribe' }),
  ])
  const s = await t.get()
  assert.strictEqual(val(s, 'C'), 1)
  assert.strictEqual(val(s, 'U'), 1)
})

test('同接と高評価は配信情報の現在値で、達成演出は1回だけ', async () => {
  const t = await setup([
    { name: 'V', metric: 'viewers', goal: 10 },
    { name: 'L', metric: 'likes', goal: 0 },
  ])
  t.plugin.subscribe('meta', { type: 'youtube', data: { viewer: 12, upVote: '1.2K' } })
  t.plugin.subscribe('meta', { type: 'youtube', data: { viewer: 8 } })
  t.plugin.subscribe('meta', { type: 'youtube', data: { viewer: 15 } })
  const s = await t.get()
  assert.strictEqual(val(s, 'V'), 15)
  assert.strictEqual(val(s, 'L'), 1200)
  assert.strictEqual(s.events.filter((e) => e.type === 'goal').length, 1)
})

test('手動操作は0未満にならず、目標の書き換えでは演出を出さない', async () => {
  const t = await setup([{ name: 'X', metric: 'manual', goal: 100 }])
  const id = t.byName('X').id
  await call(t.plugin, 'POST', { action: 'inc', id, delta: -5 })
  await call(t.plugin, 'POST', { action: 'inc', id, delta: 50 })
  await call(t.plugin, 'POST', { action: 'update', id, patch: { goal: 40 } })
  let s = await t.get()
  assert.strictEqual(val(s, 'X'), 50)
  assert.ok(s.counters[0].achievedAt)
  assert.strictEqual(s.events.filter((e) => e.type === 'goal').length, 0)
  await call(t.plugin, 'POST', { action: 'newSession' })
  s = await t.get()
  assert.strictEqual(val(s, 'X'), 0)
  assert.strictEqual(s.counters[0].achievedAt, null)
})

test('項目は10個まで、不正な操作は400で現在の状態を壊さない', async () => {
  const t = await setup([])
  for (let i = 0; i < 10; i++) await call(t.plugin, 'POST', { action: 'add', counter: { name: 'n' + i } })
  const r = await call(t.plugin, 'POST', { action: 'add', counter: {} })
  assert.strictEqual(r.code, 400)
  assert.strictEqual((await call(t.plugin, 'POST', { action: 'nope' })).code, 400)
  assert.strictEqual((await t.get()).counters.length, 10)
})

test('POST の本文が文字列で届いても受け付ける', async () => {
  const t = await setup([{ name: 'X', metric: 'manual', goal: 0 }])
  await call(t.plugin, 'POST', JSON.stringify({ action: 'inc', id: t.byName('X').id, delta: 3 }))
  assert.strictEqual(val(await t.get(), 'X'), 3)
})

test('わんコメは { comments } の形で渡す。配列直渡しも受ける', async () => {
  const t = await setup([{ name: 'C', metric: 'comments', goal: 0 }])
  // 本物のプラグイン経路
  t.plugin.subscribe('comments', { comments: [comment('a')], userNameMap: {}, options: {} })
  assert.strictEqual(val(await t.get(), 'C'), 1)
  // WebSocket API 相当の配列直渡し
  t.plugin.subscribe('comments', [comment('b')])
  assert.strictEqual(val(await t.get(), 'C'), 2)
  // 想定外の形は無視して落ちない
  t.plugin.subscribe('comments', undefined)
  t.plugin.subscribe('comments', { comments: null })
  assert.strictEqual(val(await t.get(), 'C'), 2)
})

test('同じ枠の別コメントを二重排除しない（判定は data.id）', async () => {
  const t = await setup([{ name: 'C', metric: 'comments', goal: 0 }])
  // 最上位 id は 3 件とも同じ枠 ID。data.id だけが違う
  const list = [comment('a'), comment('b'), comment('c')]
  assert.strictEqual(new Set(list.map((c) => c.id)).size, 1)
  deliver(t.plugin, list)
  assert.strictEqual(val(await t.get(), 'C'), 3)
})

test('再配送（meta.isUpdate）は数えない', async () => {
  const t = await setup([{ name: 'C', metric: 'comments', goal: 0 }])
  const a = comment('a')
  deliver(t.plugin, [a])
  // 同じ data.id で中身が更新されて届く
  deliver(t.plugin, [{ ...a, meta: { isUpdate: true } }])
  // 別の data.id でも更新配送なら数えない
  deliver(t.plugin, [{ ...comment('b'), meta: { isUpdate: true } }])
  assert.strictEqual(val(await t.get(), 'C'), 1)
})
