# Rifflane

Rifflane は、4弦ベース向けのレーン表示とリアルタイム採点を統合した検証用 UI です。現行実装は Vite + TypeScript で構成されています。

## Setup instructions

### 前提条件

- Node.js `20.x`（CI と同一。`.github/workflows/ci.yml` は Node 20 を使用）
- npm（Node.js 同梱版）
- マイク入力可能なブラウザ（推奨: Chrome / Edge 最新版）

### セットアップ

```bash
npm ci
```

### 開発起動

```bash
npm run dev
```

- デフォルト URL: `http://localhost:5173`

### 検証コマンド

```bash
npm run lint
npm run typecheck
npm run build
```

- `dev`: Vite 開発サーバ
- `build`: `tsc && vite build`
- `typecheck`: `tsc --noEmit`
- `lint`: `eslint "src/**/*.{ts,tsx}"`

2026-02-20 時点で `lint/typecheck/build` はローカル実行で通過しています。

## 現行実装の範囲

- MIDI import
  - `.mid/.midi` のドラッグ&ドロップまたはファイル選択
  - トラック一覧表示とトラック選択 import
  - E/A/D/G（開放弦 MIDI: `28/33/38/43`）へマッピングしてレーン譜面化
- audio capture
  - `getUserMedia` で `audioinput` を取得
  - telemetry 表示: sample rate / channel count / `AudioContext.baseLatency`
- worklet
  - `AudioWorkletNode` を 2 系統使用
  - Level meter（RMS/Peak）: 約 `25Hz` レポート
  - YIN pitch 推定: 約 `25Hz`、探索範囲 `35Hz - 200Hz`
- pitch / scoring / lane
  - 4 レーン（E/A/D/G）スクロール表示
  - 判定: `Perfect / Good / Miss`
  - 既定判定窓: timing `80ms` / pitch `35cents`
  - Perfect 窓: timing `40ms` / pitch `20cents`
  - latency offset: `-150ms ~ +150ms`（`localStorage` 永続化）

## WSL2 notes

- WSL2 で開発サーバを公開する場合は host 指定を推奨します。

```bash
npm run dev -- --host 0.0.0.0 --port 5173
```

- Windows 側ブラウザから `http://localhost:5173` にアクセスして確認してください。
- `localhost` で到達できない場合は、WSL2 側で `hostname -I` を実行し、`http://<WSL2のIP>:5173` を利用してください。
- マイク入力検証は、OS のマイク許可設定（Windows 設定 + ブラウザ権限）を事前に有効化してください。

## Windows testing

1. 依存関係をインストールします。`npm ci`
2. 開発サーバを起動します。`npm run dev`
3. Chrome/Edge で `http://localhost:5173` を開きます。
4. `権限取得 / デバイス更新` を押し、マイクアクセスを許可します。
5. `開始` を押し、以下を確認します。
   - 状態が `ストリーム稼働中（AudioWorklet Meter + Pitch 有効）`
   - RMS/Peak が更新
   - `Pitch Debug` の `f0Hz/midi note/confidence` が更新
6. MIDI ファイルを投入し、track 選択後 `import` を押します。
7. `start` でレーン再生し、`Latest Judgment` と統計（Perfect/Good/Miss/Accuracy）が更新されることを確認します。

## Android testing (`adb reverse`)

前提: Android 端末で開発者向けオプション + USB デバッグを有効化し、PC に `adb` を導入済み。

1. PC 側でサーバ起動

```bash
npm run dev -- --host 0.0.0.0 --port 5173
```

2. 端末接続確認

```bash
adb devices
```

3. ポート転送

```bash
adb reverse tcp:5173 tcp:5173
```

4. Android の Chrome で `http://localhost:5173` を開く
5. マイク権限を許可し、Windows testing と同じ観点（audio/midi/lane/scoring）を確認

終了時に解除する場合:

```bash
adb reverse --remove tcp:5173
```

## Known audio issues

- ブラウザが `AudioWorkletNode` を提供しない場合、キャプチャ開始時に失敗します。
- `getUserMedia` は secure context 制約の影響を受けます。環境により `http://<IP>` では許可されず、`localhost` は許可される場合があります。
- `echoCancellation/noiseSuppression/autoGainControl` は `false` を要求していますが、デバイス/OS 実装により強制無効化されない場合があります。
- pitch 推定範囲は `35Hz - 200Hz` 固定です。範囲外音程は未検出（`null`）になります。
- 入力レベルが低い場合（RMS が閾値未満）pitch は unvoiced 扱いとなり、confidence は 0 になります。
- 採点は信頼度しきい値（note on `0.82`、note off `0.55`）で安定化しているため、微小ノイズ環境では反応遅延が見える場合があります。
- モニター音は Gain 0 でミュートしているため、アプリ経由の入力音は再生されません。

## Troubleshooting guide

| 症状 | 主な原因 | 対処 |
| --- | --- | --- |
| `権限取得失敗` | ブラウザ権限拒否 / OS マイク拒否 | ブラウザのサイト権限と OS マイク許可を再設定し、再読込 |
| `audioinput デバイスが見つかりません` | デバイス未接続 / 利用中 / 権限未許可 | マイク接続確認、他アプリ占有解除、`権限取得 / デバイス更新` 再実行 |
| `開始失敗: AudioWorkletNode is not available` | 非対応ブラウザ | Chrome/Edge 最新版で再試行 |
| レベルは動くが採点がすべて Miss | ピッチ未検出 / 判定窓ずれ / レーン未開始 | lane `start` 実行、入力音量を上げる、latency offset を調整 |
| MIDI import が `NOTE_OUT_OF_RANGE` | 選択トラックの音域が E/A/D/G に割当不能 | 別トラック選択、もしくは MIDI 側で移調して再投入 |
| Android で `localhost:5173` が開けない | `adb reverse` 未設定 / 接続不良 | `adb devices` で接続確認後、`adb reverse tcp:5173 tcp:5173` を再実行 |

## Testing matrix

手動検証を以下のマトリクスで実施してください。

| ID | 環境 | 検証対象 | 手順 | 期待結果 |
| --- | --- | --- | --- | --- |
| M-01 | 共通（CI相当） | 静的検証 | `npm run lint && npm run typecheck && npm run build` | 全コマンド成功 |
| M-02 | Windows + Chrome/Edge | audio capture + worklet | 権限許可後に `開始` | RMS/Peak 更新、Pitch Debug 更新 |
| M-03 | Windows + Chrome/Edge | MIDI import | `.mid/.midi` 読込、track 選択、`import` | import 成功ステータス、レーン譜面更新 |
| M-04 | Windows + Chrome/Edge | lane/scoring | lane `start`、演奏入力 | `Latest Judgment` と統計が更新 |
| M-05 | WSL2 + Windowsブラウザ | WSL2 接続性 | `npm run dev -- --host 0.0.0.0 --port 5173` | Windows から UI 表示、操作可能 |
| M-06 | Android + Chrome | `adb reverse` 経由表示 | `adb reverse tcp:5173 tcp:5173` 後に `http://localhost:5173` | UI 表示、操作可能 |
| M-07 | Android + Chrome | audio/scoring 基本動作 | 権限許可、`開始`、lane `start` | メーター更新、判定イベント更新 |

