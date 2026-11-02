// 開発用：わんコメの代わりにテンプレート配信とプラグイン REST を再現する
// 使い方: node dev/server.js [--port 11180] [--auto]
//   --auto を付けると、偽のコメントや同接の変化を自動で流し続ける
const http = require('http')
const fs = require('fs')
const path = require('path')

const args = process.argv.slice(2)
const PORT = Number(args[args.indexOf('--port') + 1]) || 11180
const AUTO = args.includes('--auto')
const ROOT = path.join(__dirname, '..')
const TEMPLATE_DIR = path.join(ROOT, 'onecomme-template', 'fc-counter')
const STORE_FILE = path.join(__dirname, '.store.json')

// electron-store の get/set だけを真似る
const store = {
  data: fs.existsSync(STORE_FILE) ? JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')) : {},
  get(k) {
    return this.data[k]
  },
  set(k, v) {
    this.data[k] = v
    fs.writeFileSync(STORE_FILE, JSON.stringify(this.data))
  },
}

const plugin = require(path.join(ROOT, 'onecomme-plugin', 'fc-counter', 'plugin.js'))
plugin.init({ dir: __dirname, filepath: '', store, log: console }, {})

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png' }

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    if (url.pathname === '/api/plugins/' + plugin.uid) {
      let body = ''
      for await (const chunk of req) body += chunk
      const out = await plugin.request({ url: req.url, method: req.method, params: Object.fromEntries(url.searchParams), body: body ? JSON.parse(body) : undefined })
      res.writeHead(out.code, { 'Content-Type': 'application/json' })
      return res.end(out.response)
    }
    const prefix = '/templates/custom/fc-counter/'
    if (url.pathname.startsWith(prefix)) {
      const file = path.join(TEMPLATE_DIR, decodeURIComponent(url.pathname.slice(prefix.length)) || 'index.html')
      if (file.startsWith(TEMPLATE_DIR) && fs.existsSync(file) && fs.statSync(file).isFile()) {
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' })
        return res.end(fs.readFileSync(file))
      }
    }
    res.writeHead(404)
    res.end('not found')
  })
  .listen(PORT, () => {
    console.log('表示画面: http://localhost:' + PORT + '/templates/custom/fc-counter/index.html')
    console.log('操作画面: http://localhost:' + PORT + '/templates/custom/fc-counter/controller.html')
    if (AUTO) console.log('偽のイベントを自動で流している')
  })

if (AUTO) {
  let n = 0
  let viewer = 20
  let likes = 30
  const users = Array.from({ length: 40 }, (_, i) => 'auto-user-' + i)
  setInterval(() => {
    n++
    const userId = users[Math.floor(Math.random() * users.length)]
    const id = 'auto-' + Date.now() + '-' + n
    const comment = {
      id,
      service: 'youtube',
      name: 'YouTube',
      url: '',
      color: { r: 0, g: 0, b: 0 },
      data: { id, userId, liveId: 'auto-live', name: userId, isOwner: false, hasGift: false, comment: Math.random() < 0.2 ? '888' : 'こんにちは', isFirstTime: Math.random() < 0.1, badges: [], profileImage: '', timestamp: String(Date.now()) },
    }
    if (Math.random() < 0.05) Object.assign(comment.data, { hasGift: true, price: 500, currency: 'JPY', giftType: 'superchat' })
    plugin.subscribe('comments', [comment])
    if (n % 5 === 0) {
      viewer = Math.max(0, viewer + Math.round((Math.random() - 0.4) * 4))
      likes += Math.random() < 0.6 ? 1 : 0
      plugin.subscribe('meta', { type: 'youtube', service: {}, data: { viewer, upVote: String(likes), total: viewer * 3 } })
    }
  }, 900)
}
