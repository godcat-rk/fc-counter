# fc-counter

配信中に決めた目標（コメント数・同時接続数・スパチャ金額など）の達成度を、OBS の画面上へリアルタイムに表示するツール。元は作者が自分の YouTube 配信で使うために作った。販売はしないが、知人の配信者へそのまま渡して各自で手を入れてよい。

経緯と現在地は [docs/handoff.md](docs/handoff.md) にある。**作業を始める前に必ず読むこと。** わんコメの実機での挙動（公式ドキュメントに無いもの）がそこに書いてある。

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

## わんコメの実機での挙動（確認済み。推測で上書きしないこと）

詳細と実データの例は [docs/handoff.md](docs/handoff.md) にある。要点だけ：

- **`subscribe('comments')` の中身は配列ではなく `{ comments, userNameMap, options }`。** SDK の WebSocket API の型（`Comment[]`）とは違う。`commentsOf()` が両方を受ける。
- **`comment.id` は「枠の ID」で、同じ配信のコメントは全件同じ値。** コメントごとに一意なのは `data.id`。重複排除のキーを間違えると2件目以降が全部捨てられる。
- **`comment.meta.isUpdate` が立った配送は数えない。** 再配送（再接続時のバックログ、連投の個数更新、金額の後追い確定）の印。SDK の型定義が明示している作法。
- **REST は二重に包まれ、HTTP ステータスは常に 200。** `{"code":200,"response":"<JSON文字列>"}` で返る。`res.ok` は当てにならないので、中身の `error` で判定する。
- **デバッグは `%APPDATA%\onecomme\logs\plugin.log`。** プラグイン内の `console.log()` がここへ出る。イベントの中身が分からないときは `subscribe` の先頭で `JSON.stringify(args)` を吐かせる。仕込んだらプラグインウィンドウで「再読み込み」する。
- **検証はわんコメの「コメントテスター」で行う。** 配信も課金もせず、本物のデータ形式でコメント・スパチャ（金額指定可）・ギフトを流せる。ただし `meta`（同接・高評価）は流れないので、そこだけは配信枠の接続が要る。

## 守ること

- **状態を持つのはプラグインだけにする。** テンプレートは表示と命令の送信だけを担う。OBS の表示画面とドックの間で localStorage や BroadcastChannel が共有されるかは確かめておらず、それを頼る作りは避けた。
- **OBS の内蔵ブラウザ（CEF）は古い版の場合がある。** `color-mix()` や CSS の `translate` プロパティなど、新しめの機能は使わない。色の混ぜ合わせは JS の `mix()` で行う。（開発機の OBS 32.1.2 は CEF 127 で、どちらも使える世代だった。ただし渡す相手の OBS が古い可能性は残るため、保守的な書き方を維持する。）
- **集計を変えたらテストを足して `npm test` を通す。** わんコメのイベントの形は、SDK の型定義（`npm pack @onecomme.com/onesdk` で取れる `dist/types/`）を一次情報にする。推測で欄の名前を決めない。
- **偽データで通したテストを根拠にしない。** 初版は `dev/server.js` の偽データでテスト9件を通していたが、実機ではコメントが1件も数えられなかった。想定が間違っていれば、テストも同じ間違いを写すだけになる。実データは `plugin.log` で確かめる。
- **ビルドの工程を入れない。** 素の HTML・CSS・JS のまま、ファイルを置けば動く状態を保つ。
- `install.ps1` は UTF-8（BOM 付き）で保存する。BOM が無いと、Windows PowerShell 5.1 で日本語が文字化けする。
- ソースは CRLF で保存されている。編集時に改行コードを混ぜない。
- 依存パッケージは入れない。Node 標準だけで開発とテストが回る状態を保つ。
