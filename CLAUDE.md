# fc-counter

配信中に決めた目標（コメント数・同時接続数・スパチャ金額など）の達成度を、OBS の画面上へリアルタイムに表示するツール。オーナーが自分の YouTube 配信で使う。配布や販売はしない。

経緯と現在地は [docs/handoff.md](docs/handoff.md) にある。作業を始める前に読むこと。

## 構成

コメントの受信はわんコメ（OneComme）に任せ、その上にプラグインとテンプレートを載せる。

```
YouTube ─▶ わんコメ ─subscribe('comments'|'meta')─▶ plugin.js（数と設定を持つ唯一の場所）
                                                     ▲ REST: GET=状態 / POST={action,...}
                         index.html（OBSブラウザソース）─┤ 約0.3秒ごとに GET
                    controller.html（OBSカスタムドック）─┘ 操作は POST
```

- `onecomme-plugin/fc-counter/plugin.js`: わんコメのプラグイン（CommonJS、1ファイル完結）。集計、保存（`api.store`）、REST の受け口（`request()`）を担う。
- `onecomme-template/fc-counter/`: `index.html`（表示画面）、`controller.html`（操作画面）、`common.js`（REST を読む共通処理）。
- `dev/server.js`: わんコメの代わりに、テンプレートの配信と `/api/plugins/fc-counter.local` を再現する開発用サーバー。
- `test/plugin.test.js`: 集計ロジックのテスト。

## コマンド

```
npm run dev   # http://localhost:11180 で起動し、偽のコメントを自動で流す（--auto）
npm test      # node --test
.\install.ps1 # Windows: %APPDATA%\onecomme の plugins と templates\custom へコピー
```

表示画面をブラウザで確かめるときは、URL の末尾に `?bg=1` を付けると背景が付く。

## 守ること

- **状態を持つのはプラグインだけにする。** テンプレートは表示と命令の送信だけを担う。OBS の表示画面とドックの間で localStorage や BroadcastChannel が共有されるかは確かめておらず、それを頼る作りは避けた。
- **OBS の内蔵ブラウザ（CEF）は古い版の場合がある。** `color-mix()` や CSS の `translate` プロパティなど、新しめの機能は使わない。色の混ぜ合わせは JS の `mix()` で行う。
- **集計を変えたらテストを足して `npm test` を通す。** わんコメのイベントの形は、SDK の型定義（npm の `@onecomme.com/onesdk` の `dist/types`）を一次情報にする。推測で欄の名前を決めない。
- **ビルドの工程を入れない。** 素の HTML・CSS・JS のまま、ファイルを置けば動く状態を保つ。
- `install.ps1` は UTF-8（BOM 付き）で保存する。BOM が無いと、Windows PowerShell 5.1 で日本語が文字化けする。
- 依存パッケージは入れない。Node 標準だけで開発とテストが回る状態を保つ。
