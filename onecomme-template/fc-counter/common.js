// 表示画面と操作画面の共通処理。プラグインの REST を読むだけ
const FC = (() => {
  const UID = 'fc-counter.local'
  const API = '/api/plugins/' + UID

  // わんコメが response を文字列で返す場合と、さらに包む場合の両方に対応する
  async function readJson(res) {
    let body = await res.text()
    for (let i = 0; i < 2 && typeof body === 'string'; i++) {
      try {
        body = JSON.parse(body)
      } catch (e) {
        break
      }
    }
    if (body && typeof body.response === 'string') {
      try {
        body = JSON.parse(body.response)
      } catch (e) {
        // そのまま
      }
    }
    return body
  }

  async function getState() {
    const res = await fetch(API, { cache: 'no-store' })
    const body = await readJson(res)
    if (!res.ok || !body || body.error) throw new Error((body && body.error) || 'HTTP ' + res.status)
    return body
  }

  async function send(action, payload = {}) {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...payload }),
    })
    const body = await readJson(res)
    if (!res.ok || !body || body.error) throw new Error((body && body.error) || 'HTTP ' + res.status)
    return body
  }

  // 一定間隔で状態を取りに行く。失敗は onError に渡して続ける
  function poll(onState, onError, interval = 300) {
    let stopped = false
    async function tick() {
      if (stopped) return
      try {
        onState(await getState())
      } catch (e) {
        onError && onError(e)
      }
      setTimeout(tick, interval)
    }
    tick()
    return () => (stopped = true)
  }

  function fmt(n) {
    return Number(n || 0).toLocaleString('ja-JP')
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch])
  }

  return { getState, send, poll, fmt, esc }
})()
