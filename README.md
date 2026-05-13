# Art of the Day

メトロポリタン美術館の公開ドメイン作品を、1日1点ずつ日本語解説つきで楽しむ静的 Web アプリです。  
`index.html` と `translations.json` だけで動くので、GitHub Pages にそのまま載せられます。

## 構成

| ファイル | 役割 |
|---|---|
| `index.html` | アプリ本体。CSS / JavaScript をすべて内包 |
| `translations.json` | 作品データ本体。公開時に Pages からそのまま配信 |
| `generate.js` | Met API と翻訳 / 文章生成 API を使ってデータを再生成 |
| `scripts/prepare-pages.js` | 公開用に必要ファイルだけ `dist-pages/` へコピー |
| `.nojekyll` | GitHub Pages を素の静的配信として動かすための設定 |

## いまの運用

- 現在の `translations.json` は **180件** 構成です
- 解説は **ハイブリッド方式** です
  - DeepL で基本項目を翻訳
  - LLM で自然な日本語解説を生成
  - 失敗時はテンプレ文にフォールバック

## 必要な環境変数

このリポジトリで再生成を行う場合は、このディレクトリの `.env` に必要な認証情報を設定します。
利用する翻訳 API / LLM に応じて、`generate.js` が参照する環境変数を合わせてください。

```env
YOUR_TRANSLATION_TOKEN=...
YOUR_LLM_TOKEN=...
```

任意:

```env
ART_OF_THE_DAY_SUMMARY_MODEL=gpt-4.1-mini
```

## セットアップ

```bash
git clone https://github.com/Yoshiki1011/art-of-the-day.git
cd art-of-the-day
npm install
```

## データ再生成

180件で更新:

```bash
npm run generate:180
```

GitHub Pages 公開前の標準更新:

```bash
npm run build:pages
```

公開用アーティファクトだけ作る:

```bash
npm run prepare:pages
```

365件で更新:

```bash
npm run generate:365
```

任意件数で更新:

```bash
node generate.js --limit 60
```

別ファイルに試し出力:

```bash
node generate.js --limit 5 --output /tmp/art-of-the-day-sample.json
```

AI を使わずテンプレ文のみで生成:

```bash
node generate.js --limit 30 --no-ai
```

## ローカル確認

```bash
npm run preview
```

ブラウザで `http://127.0.0.1:3012/` を開きます。

## GitHub Pages で公開する

このディレクトリの中身を、そのまま Pages の公開対象に置けば動きます。

### シンプルな公開手順

1. `translations.json` を最新化する
   標準運用では `npm run build:pages`
2. `index.html` / `translations.json` / `README.md` / `.nojekyll` をコミットする
3. GitHub では `.github/workflows/deploy-pages.yml` を有効にする
4. 必要なら Actions の `Deploy Art of the Day Pages` を手動実行する
5. GitHub Pages の公開 URL を開いて表示確認する

### Pages 用の注意

- `index.html` からは `./translations.json` を相対参照しているため、同じ階層に置く
- 実行時 API 呼び出しはないため、公開後の CORS 問題は起きない
- `.nojekyll` を置いているので、Jekyll 変換を挟まず静的配信できる
- 画像は Met Museum の公開 URL を直接参照する
- workflow は `dist-pages/` を Pages artifact として配信する

## 品質メモ

- 作品によっては Met 側のメタデータが薄く、AI 解説もやや簡潔になります
- より濃い解説にしたい場合は `generate.js` のプロンプトを調整すると改善できます
- 現在の UI は `web-large` 画像を優先して読み、失敗時だけ別候補へフォールバックします

## 変更時のおすすめ確認

```bash
npm run check
node -e "const d=require('./translations.json'); console.log(d.objectIds.length)"
```
