# RSS AI Radio — デプロイ手順書（Vercel + PWA）

## 全体の流れ（10〜15分で完了）

```
GitHubにコードをアップ → Vercelと連携 → URLが発行される → AndroidのChromeでインストール
```

---

## STEP 1 — GitHubアカウントを作る（持っている人はスキップ）

1. https://github.com を開く
2. 「Sign up」で無料アカウント作成

---

## STEP 2 — 新しいリポジトリを作る

1. GitHubにログイン後、右上の「+」→「New repository」
2. Repository name: `rss-ai-radio`
3. Public を選択
4. 「Create repository」をクリック

---

## STEP 3 — コードをアップロード

### PCがある場合（Git）
```bash
cd rss-ai-radio
git init
git add .
git commit -m "first commit"
git branch -M main
git remote add origin https://github.com/あなたのユーザー名/rss-ai-radio.git
git push -u origin main
```

### PCがない / GitHubのWeb UIで直接アップロードする場合

1. 作成したリポジトリのページを開く
2. 「uploading an existing file」をクリック
3. ZIPを解凍したフォルダ内のファイルを**全て選択してドラッグ&ドロップ**
   - `src/` フォルダ
   - `public/` フォルダ
   - `index.html`
   - `package.json`
   - `vite.config.js`
   - `vercel.json`
   - `.gitignore`
   - ※ `.env` はアップロード**しない**（APIキーが漏れるため）
4. 「Commit changes」をクリック

---

## STEP 4 — Vercelにデプロイ

1. https://vercel.com を開く
2. 「Sign up」→「Continue with GitHub」でGitHubアカウントでログイン
3. 「Add New Project」→ `rss-ai-radio` を選択 → 「Import」
4. **Environment Variables（環境変数）を設定する** ← 重要！
   - 「Environment Variables」セクションを開く
   - Name: `VITE_ANTHROPIC_API_KEY`
   - Value: `sk-ant-api03-あなたのAPIキー`
   - 「Add」をクリック
5. 「Deploy」をクリック
6. 1〜2分でデプロイ完了 🎉
7. `https://rss-ai-radio-xxxx.vercel.app` のようなURLが発行される

---

## STEP 5 — AndroidにPWAとしてインストール

1. AndroidのChromeで発行されたURLを開く
2. 画面右上の「︙（メニュー）」をタップ
3. 「**ホーム画面に追加**」をタップ
4. 「追加」をタップ
5. ホーム画面に📻アイコンが出現！

> タップするとURLバーなしのフルスクリーンでアプリが起動します。

---

## APIキーの取得方法（まだ持っていない場合）

1. https://console.anthropic.com を開く
2. ログイン / アカウント作成
3. 左メニュー「API Keys」→「Create Key」
4. 生成された `sk-ant-api03-...` をコピー
5. Vercelの環境変数に貼り付ける

> 無料枠あり（毎月一定量まで無料）

---

## アップデートする場合

コードを変更してGitHubにpushするだけで、Vercelが自動的に再デプロイします。

```bash
git add .
git commit -m "update"
git push
```

---

## トラブルシューティング

### 「ホーム画面に追加」が表示されない
- Chromeのバージョンを最新にアップデート
- HTTPSのURLかどうか確認（Vercelは自動でHTTPS）

### APIキーエラーになる
- Vercelの環境変数に `VITE_ANTHROPIC_API_KEY` が正しく設定されているか確認
- 再デプロイ（Vercelダッシュボード → Deployments → Redeploy）

### 音声が出ない
- Androidの音量を上げる
- Chromeの設定 → サイトの設定 → 音声 → 許可

---

## URLを友達にシェアすれば誰でも使える 🎉

Vercelで発行されたURLをLINEやXでシェアするだけで、
相手もブラウザで開いてホーム画面に追加できます。
