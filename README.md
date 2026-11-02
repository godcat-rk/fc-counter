# fc-counter

配信中に決めた目標（コメント数・同時接続数・スパチャ金額など）の達成度を、OBSの画面上へリアルタイムに表示するツール。コメントの受信はわんコメ（OneComme）に任せる。

## 構成

| 場所 | 役割 |
|---|---|
| `onecomme-plugin/fc-counter/plugin.js` | わんコメのプラグイン。コメントと配信情報を受け取って数え、数と設定を保存する。状態を持つのはここだけ |
| `onecomme-template/fc-counter/index.html` | 表示画面。OBSのブラウザソースに入れる（1920×1080、背景透過） |
| `onecomme-template/fc-counter/controller.html` | 操作画面。OBSのカスタムブラウザドックに入れる |
| `onecomme-template/fc-counter/common.js` | 両画面の共通処理。プラグインの REST（`/api/plugins/fc-counter.local`）を約0.3秒ごとに読む |
| `dev/server.js` | 開発用。わんコメなしでテンプレートとプラグインを動かす |
| `test/plugin.test.js` | 数え方のテスト |

数える処理をプラグインに置いた理由は2つある。1つ目は、表示画面と操作画面が同じ状態を見られること。2つ目は、表示画面を2枚開いても二重に数えないことだ。

## 数えられるもの

| 数え方 | 中身 |
|---|---|
| コメント数 | 配信者本人以外のコメントの件数。スパチャも含み、メンバー加入とギフトの通知は除く。連投制限（N秒に1回）を設定できる |
| コメントした人数 | この配信でコメントした人を1人1回数える |
| 初見さん | わんコメの初見フラグ（`isFirstTime`）が付いた人を1人1回数える |
| キーワード | 本文にキーワードを含むコメント。1人1回までにもできる |
| スパチャ金額 | 円建てのスパチャとスーパーステッカーの合計金額。外貨は数えない |
| メンバー加入 | 新規加入の件数。メンバーシップギフトの件数を含めることもできる |
| 同時接続数・高評価数 | わんコメの配信情報（meta）の現在値 |
| 手動 | ボタンで数える |

すべての項目は ±ボタンで補正できる。項目は10個まで作れる。

## Windows への導入

1. わんコメをインストールして一度起動し、YouTube の配信 URL を登録する。
2. このフォルダで PowerShell を開いて `.\install.ps1` を実行する。プラグインは `%APPDATA%\onecomme\plugins\fc-counter\` に、テンプレートは `%APPDATA%\onecomme\templates\custom\fc-counter\` にコピーされる。
3. わんコメを再起動し、設定のプラグイン一覧で fc-counter を有効にする。
4. OBS で次の2つを登録する。
   - ブラウザソース（幅1920・高さ1080）: `http://localhost:11180/templates/custom/fc-counter/index.html`
   - ドック → カスタムブラウザドック: `http://localhost:11180/templates/custom/fc-counter/controller.html`
5. 操作画面の「テスト」を開いて偽のコメントを流し、表示画面の数が増えることを確かめる。

## 開発（わんコメなし）

```
npm run dev     # http://localhost:11180 で起動し、偽のコメントを自動で流す
npm test
```

表示画面をブラウザで確かめるときは、URL の末尾に `?bg=1` を付けると背景が付く。

## 未検証の事項（Windows 実機で確かめる）

開発は Mac 上で、わんコメの代わりに `dev/server.js` を使って行った。次の5点は、わんコメの型定義と公開ドキュメントを根拠に作ったもので、実機ではまだ動かしていない。

- プラグインの置き場所（`plugins\fc-counter\plugin.js`）を、わんコメが認識するか。
- `request()` の戻り値（`response` に JSON 文字列を入れている）が、テンプレート側でそのまま読めるか。`common.js` は二重に包まれた場合も解釈する。
- `subscribe('meta')` の高評価数が、`totalLikeCount` と `upVote` のどちらに入るか。今は前者を優先し、無ければ後者を読む。
- メンバー加入とギフトが `giftType`（`subscribe` と `sponsorgift`）で判別できるか。
- OBS 内蔵ブラウザで演出が崩れないか。新しめの CSS（`color-mix` など）は避けて書いた。
