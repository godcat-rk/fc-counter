// fc-counter: わんコメ プラグイン
// 数と設定を持つ唯一の場所。コメントと配信情報を受け取って数え、
// 表示画面と操作画面には REST（/api/plugins/<uid>）で状態を渡す。

const UID = 'fc-counter.local'
const SCHEMA = 1
const MAX_COUNTERS = 10
const MAX_PROCESSED = 5000
const MAX_EVENTS = 60

// 数え方の一覧。live は配信情報の現在値をそのまま表示するもの
const METRICS = {
  comments: { label: 'コメント数', live: false },
  commenters: { label: 'コメントした人数', live: false },
  firstTimers: { label: '初見さん', live: false },
  keyword: { label: 'キーワード', live: false },
  superchat: { label: 'スパチャ金額', live: false },
  members: { label: 'メンバー加入', live: false },
  viewers: { label: '同時接続数', live: true },
  likes: { label: '高評価数', live: true },
  manual: { label: '手動', live: false },
}

const PALETTE = ['#4fc3f7', '#ff8a80', '#ffd54f', '#81c784', '#ba68c8', '#4db6ac', '#f06292', '#9575cd', '#ffb74d', '#90a4ae']

let api = null
let state = null
let saveTimer = null

function now() {
  return Date.now()
}

function newSession() {
  return {
    id: String(now()),
    startedAt: now(),
    commenters: {},
    firstTimers: {},
    keyword: {},
    cooldown: {},
    processed: [],
  }
}

function defaultState() {
  return {
    schema: SCHEMA,
    rev: 0,
    seq: 0,
    counters: [
      makeCounter({ name: 'コメント', metric: 'comments', goal: 100 }, 0),
      makeCounter({ name: '同接', metric: 'viewers', goal: 50 }, 1),
      makeCounter({ name: '高評価', metric: 'likes', goal: 100 }, 2),
    ],
    layout: { position: 'bottom-left', scale: 1, celebrate: true },
    live: { viewer: null, likes: null, total: null, liveId: null },
    status: { lastCommentAt: null, lastMetaAt: null },
    session: newSession(),
    events: [],
  }
}

function makeCounter(input, index) {
  const metric = METRICS[input.metric] ? input.metric : 'manual'
  return {
    id: 'c' + now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: String(input.name || METRICS[metric].label).slice(0, 30),
    metric,
    goal: toCount(input.goal, 100),
    color: input.color || PALETTE[index % PALETTE.length],
    visible: input.visible !== false,
    auto: 0,
    manual: 0,
    achievedAt: null,
    opts: {
      cooldownSec: 0,
      keyword: '',
      oncePerUser: true,
      includeGifts: true,
      ...(input.opts || {}),
    },
  }
}

// 0以上の安全な整数だけを受け付ける
function toCount(v, fallback) {
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0) return fallback
  return Math.min(Math.floor(n), Number.MAX_SAFE_INTEGER)
}

function toInt(v, fallback) {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.max(-1e12, Math.min(Math.trunc(n), 1e12))
}

// "1.2万" "3.4K" "1,234" のような表記も数値にする
function parseCount(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const s = v.replace(/[,\s]/g, '')
  const m = s.match(/^([\d.]+)([KkMm万]?)/)
  if (!m) return null
  const base = parseFloat(m[1])
  if (!Number.isFinite(base)) return null
  const mul = { k: 1e3, K: 1e3, m: 1e6, M: 1e6, 万: 1e4 }[m[2]] || 1
  return Math.round(base * mul)
}

function liveValue(metric) {
  if (metric === 'viewers') return state.live.viewer || 0
  if (metric === 'likes') return state.live.likes || 0
  return 0
}

function valueOf(c) {
  const base = METRICS[c.metric].live ? liveValue(c.metric) : c.auto
  return Math.max(0, base + c.manual)
}

function pushEvent(ev) {
  state.seq += 1
  state.events.push({ seq: state.seq, at: now(), ...ev })
  if (state.events.length > MAX_EVENTS) state.events.splice(0, state.events.length - MAX_EVENTS)
}

// 値が動いたあとに呼ぶ。演出を出すかどうかもここで決める
function afterChange(c, before, celebrate) {
  const after = valueOf(c)
  if (after !== before) pushEvent({ type: 'change', counterId: c.id, delta: after - before, value: after })
  if (c.goal > 0 && after >= c.goal && !c.achievedAt) {
    c.achievedAt = now()
    if (celebrate) pushEvent({ type: 'goal', counterId: c.id, value: after })
  }
}

// 目標や値を手で書き換えたときは演出なしで達成状態だけ合わせる
function syncAchieved(c) {
  const v = valueOf(c)
  if (c.goal > 0 && v >= c.goal) c.achievedAt = c.achievedAt || now()
  else c.achievedAt = null
}

function markProcessed(id) {
  const p = state.session.processed
  p.push(id)
  if (p.length > MAX_PROCESSED) p.splice(0, p.length - MAX_PROCESSED)
}

function userKey(comment) {
  return (comment.service || '') + ':' + ((comment.data && comment.data.userId) || '')
}

// メンバー加入やギフトの通知はコメントとして数えない。スパチャは本文付きのコメントなので数える
const NON_CHAT_GIFTS = ['subscribe', 'sponsorgift', 'giftreceived']
function isChat(d) {
  return !d.hasGift || !NON_CHAT_GIFTS.includes(d.giftType)
}

function jpyAmount(d) {
  if (!d || typeof d.price !== 'number' || d.price <= 0) return 0
  const cur = d.currency || ''
  const unit = d.unit || ''
  if (cur === 'JPY' || unit === '¥' || unit === '￥' || unit === 'JPY') return Math.round(d.price)
  return 0
}

// 1件のコメントが、ある項目をいくつ増やすか
function countFor(c, comment, d, t) {
  const uk = userKey(comment)
  const text = String(d.comment || '')
  const s = state.session
  switch (c.metric) {
    case 'comments': {
      if (!isChat(d)) return 0
      const sec = c.opts.cooldownSec
      if (sec > 0) {
        const map = (s.cooldown[c.id] = s.cooldown[c.id] || {})
        if (map[uk] && t - map[uk] < sec * 1000) return 0
        map[uk] = t
      }
      return 1
    }
    case 'commenters':
      return 0 // ユーザー単位の集合でまとめて数える（下の ingestComment）
    case 'firstTimers':
      return 0
    case 'keyword': {
      const kw = String(c.opts.keyword || '').trim()
      if (!kw || !text.toLowerCase().includes(kw.toLowerCase())) return 0
      if (c.opts.oncePerUser) {
        const set = (s.keyword[c.id] = s.keyword[c.id] || {})
        if (set[uk]) return 0
        set[uk] = 1
      }
      return 1
    }
    case 'superchat':
      return jpyAmount(d)
    case 'members': {
      if (d.giftType === 'subscribe') return 1
      if (c.opts.includeGifts && d.giftType === 'sponsorgift') return toCount(d.giftCount, 1) || 1
      return 0
    }
    default:
      return 0
  }
}

function ingestComment(comment) {
  if (!comment || !comment.data || comment.service === 'system') return false
  if (comment.meta && comment.meta.isUpdate) return false
  const d = comment.data
  const id = comment.service + ':' + (d.id || comment.id)
  if (state.session.processed.includes(id)) return false
  markProcessed(id)
  if (d.isOwner) return false

  const t = now()
  state.status.lastCommentAt = t
  if (d.liveId) state.live.liveId = d.liveId

  const uk = userKey(comment)
  const s = state.session
  const isNewCommenter = isChat(d) && !s.commenters[uk]
  if (isNewCommenter) s.commenters[uk] = 1
  const isNewFirstTimer = d.isFirstTime === true && !s.firstTimers[uk]
  if (isNewFirstTimer) s.firstTimers[uk] = 1

  for (const c of state.counters) {
    const before = valueOf(c)
    let add = countFor(c, comment, d, t)
    if (c.metric === 'commenters' && isNewCommenter) add = 1
    if (c.metric === 'firstTimers' && isNewFirstTimer) add = 1
    if (add > 0) {
      c.auto += add
      afterChange(c, before, true)
    }
  }
  return true
}

function ingestMeta(payload) {
  const m = (payload && payload.data) || {}
  if (payload && payload.type && payload.type !== 'youtube') return false
  const before = state.counters.map(valueOf)
  const viewer = parseCount(m.viewer)
  const likes = typeof m.totalLikeCount === 'number' ? m.totalLikeCount : parseCount(m.upVote)
  if (viewer !== null) state.live.viewer = viewer
  if (likes !== null) state.live.likes = likes
  if (typeof m.total === 'number') state.live.total = m.total
  state.status.lastMetaAt = now()
  state.counters.forEach((c, i) => {
    if (METRICS[c.metric].live) afterChange(c, before[i], true)
  })
  return true
}

function publicState() {
  return {
    schema: state.schema,
    rev: state.rev,
    seq: state.seq,
    serverTime: now(),
    counters: state.counters.map((c) => ({ ...c, value: valueOf(c), live: METRICS[c.metric].live })),
    layout: state.layout,
    live: state.live,
    status: state.status,
    session: { id: state.session.id, startedAt: state.session.startedAt },
    events: state.events,
    metrics: Object.fromEntries(Object.entries(METRICS).map(([k, v]) => [k, v.label])),
  }
}

function touch() {
  state.rev += 1
  if (!api || !api.store) return
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      api.store.set('state', state)
    } catch (e) {
      api.log && api.log.error('save failed', e)
    }
  }, 500)
}

function findCounter(id) {
  const c = state.counters.find((x) => x.id === id)
  if (!c) throw new Error('項目が見つからない: ' + id)
  return c
}

// 操作画面からの命令
function handleAction(body) {
  const a = body.action
  switch (a) {
    case 'add': {
      if (state.counters.length >= MAX_COUNTERS) throw new Error('項目は' + MAX_COUNTERS + '個まで')
      const c = makeCounter(body.counter || {}, state.counters.length)
      state.counters.push(c)
      syncAchieved(c)
      break
    }
    case 'update': {
      const c = findCounter(body.id)
      const p = body.patch || {}
      if (p.name !== undefined) c.name = String(p.name).slice(0, 30)
      if (p.metric !== undefined && METRICS[p.metric] && p.metric !== c.metric) {
        c.metric = p.metric
        c.auto = 0
      }
      if (p.goal !== undefined) c.goal = toCount(p.goal, c.goal)
      if (p.color !== undefined) c.color = String(p.color).slice(0, 20)
      if (p.visible !== undefined) c.visible = !!p.visible
      if (p.opts) {
        if (p.opts.cooldownSec !== undefined) c.opts.cooldownSec = toCount(p.opts.cooldownSec, 0)
        if (p.opts.keyword !== undefined) c.opts.keyword = String(p.opts.keyword).slice(0, 50)
        if (p.opts.oncePerUser !== undefined) c.opts.oncePerUser = !!p.opts.oncePerUser
        if (p.opts.includeGifts !== undefined) c.opts.includeGifts = !!p.opts.includeGifts
      }
      syncAchieved(c)
      break
    }
    case 'remove': {
      state.counters = state.counters.filter((x) => x.id !== body.id)
      break
    }
    case 'move': {
      const i = state.counters.findIndex((x) => x.id === body.id)
      const j = i + (body.dir < 0 ? -1 : 1)
      if (i >= 0 && j >= 0 && j < state.counters.length) {
        const [c] = state.counters.splice(i, 1)
        state.counters.splice(j, 0, c)
      }
      break
    }
    case 'inc': {
      const c = findCounter(body.id)
      const before = valueOf(c)
      const delta = toInt(body.delta, 0)
      // 0未満にはしない
      c.manual += Math.max(delta, -before)
      afterChange(c, before, true)
      break
    }
    case 'setValue': {
      const c = findCounter(body.id)
      const before = valueOf(c)
      const target = toCount(body.value, before)
      c.manual += target - before
      afterChange(c, before, false)
      syncAchieved(c)
      break
    }
    case 'resetCounter': {
      const c = findCounter(body.id)
      c.auto = 0
      c.manual = 0
      c.achievedAt = null
      syncAchieved(c)
      break
    }
    case 'newSession': {
      // 新しい配信：人数の集合や重複防止をリセットし、数も0に戻す
      state.session = newSession()
      state.live = { viewer: null, likes: null, total: null, liveId: null }
      for (const c of state.counters) {
        c.auto = 0
        c.manual = 0
        c.achievedAt = null
      }
      pushEvent({ type: 'reset' })
      break
    }
    case 'setLayout': {
      const l = body.layout || {}
      const positions = ['bottom-left', 'bottom-right', 'bottom-center', 'top-left', 'top-right', 'left', 'right']
      if (positions.includes(l.position)) state.layout.position = l.position
      if (l.scale !== undefined) {
        const s = Number(l.scale)
        if (Number.isFinite(s)) state.layout.scale = Math.min(2, Math.max(0.4, s))
      }
      if (l.celebrate !== undefined) state.layout.celebrate = !!l.celebrate
      break
    }
    case 'simulate': {
      simulate(body.event || {})
      break
    }
    case 'testGoal': {
      const c = findCounter(body.id)
      pushEvent({ type: 'goal', counterId: c.id, value: valueOf(c), test: true })
      break
    }
    default:
      throw new Error('不明な操作: ' + a)
  }
  touch()
}

// テスト用：わんコメと同じ形の偽イベントを本番と同じ経路に流す
let simCount = 0
function simulate(ev) {
  simCount += 1
  const id = 'sim-' + now() + '-' + simCount
  const userId = ev.userId || 'sim-user-' + Math.floor(Math.random() * 1e6)
  const base = {
    id,
    service: 'youtube',
    name: 'テスト',
    url: '',
    color: { r: 0, g: 0, b: 0 },
    data: {
      id,
      userId,
      liveId: 'sim-live',
      name: ev.name || 'テストさん',
      isOwner: false,
      hasGift: false,
      profileImage: '',
      badges: [],
      timestamp: String(now()),
      comment: ev.text || 'テストコメント',
      isFirstTime: !!ev.firstTime,
      isModerator: false,
      isMember: false,
      autoModerated: false,
    },
  }
  if (ev.kind === 'comment') {
    ingestComment(base)
  } else if (ev.kind === 'superchat') {
    base.data.hasGift = true
    base.data.price = toCount(ev.amount, 500)
    base.data.currency = 'JPY'
    base.data.giftType = 'superchat'
    ingestComment(base)
  } else if (ev.kind === 'member') {
    base.data.hasGift = true
    base.data.giftType = 'subscribe'
    ingestComment(base)
  } else if (ev.kind === 'meta') {
    const data = {}
    if (ev.viewer !== undefined) data.viewer = ev.viewer
    if (ev.likes !== undefined) data.upVote = String(ev.likes)
    ingestMeta({ type: 'youtube', data })
  }
}

function migrate(saved) {
  if (!saved || saved.schema !== SCHEMA || !Array.isArray(saved.counters)) return defaultState()
  const d = defaultState()
  return {
    ...d,
    ...saved,
    layout: { ...d.layout, ...(saved.layout || {}) },
    live: { ...d.live, ...(saved.live || {}) },
    status: { ...d.status, ...(saved.status || {}) },
    session: { ...newSession(), ...(saved.session || {}) },
    events: [],
  }
}

// わんコメはプラグインへ { comments, userNameMap, options } の形で渡す。
// WebSocket API は配列をそのまま送るため、どちらでも受け取れるようにする。
function commentsOf(payload) {
  if (Array.isArray(payload)) return payload
  if (payload && Array.isArray(payload.comments)) return payload.comments
  return []
}

function parseBody(body) {
  if (body == null) return {}
  if (typeof body === 'string') {
    try {
      return JSON.parse(body)
    } catch (e) {
      return {}
    }
  }
  return body
}

const plugin = {
  name: 'fc-counter',
  uid: UID,
  version: '0.1.0',
  author: 'godcat',
  permissions: ['comments', 'meta'],
  defaultState: {},

  init(pluginApi) {
    api = pluginApi
    let saved = null
    try {
      saved = api.store && api.store.get('state')
    } catch (e) {
      saved = null
    }
    state = migrate(saved)
  },

  subscribe(type, ...args) {
    if (!state) state = defaultState()
    let changed = false
    if (type === 'comments') {
      for (const c of commentsOf(args[0])) changed = ingestComment(c) || changed
    } else if (type === 'meta') {
      changed = ingestMeta(args[0])
    }
    if (changed) touch()
  },

  async request(req) {
    if (!state) state = defaultState()
    const json = (code, obj) => ({ code, response: JSON.stringify(obj) })
    try {
      if (req.method === 'GET') return json(200, publicState())
      if (req.method === 'POST') {
        handleAction(parseBody(req.body))
        return json(200, publicState())
      }
      return json(405, { error: 'method not allowed' })
    } catch (e) {
      return json(400, { error: e.message })
    }
  },

  destroy() {
    clearTimeout(saveTimer)
    if (api && api.store && state) {
      try {
        api.store.set('state', state)
      } catch (e) {
        // 終了時の保存失敗は諦める
      }
    }
  },
}

module.exports = plugin
