# 実オーディオ入力を伴う統合テスト計画

## 0. 文書情報

- 文書ID: `QA-IT-AUDIO-001`
- 作成日: `2026-02-21`
- 対象: Rifflane フロントエンド（実マイク入力 + 採点 + Diagnostics）
- 前提バージョン:
  - Node.js `20.x`（`docs/testing-guide.md` 前提）
  - npm
  - Chrome Stable（実測バージョンは結果記録に残す）

## 1. 目的 / スコープ / 非スコープ

### 1.1 目的

実オーディオ入力を用いた E2E 観点で、以下の品質を検証する。

- マイク入力取得から Pitch 判定、採点表示までの連動性
- latency offset 調整機能の有効性と境界値安全性
- Diagnostics 指標の可視化と実運用時の観測可能性
- Windows Chrome と Android Chrome の挙動差分の把握

### 1.2 スコープ

- `getUserMedia` 権限取得、デバイス列挙、入力開始/停止
- AudioWorklet 由来の level/pitch 更新
- pitch confidence による note on/off 判定
- lane 再生中の採点更新（`Perfect/Good/Miss/Accuracy`）
- diagnostics panel の主要メトリクス表示
- latency offset の調整、永続化、再読込後の復元

### 1.3 非スコープ

- 楽器演奏スキル依存の絶対スコア保証
- 端末個体差を完全に吸収する閾値最適化
- CI での自動判定化（本書は手動統合試験）
- MIDI 変換アルゴリズム自体の単体精度検証

## 2. 根拠コード（`src/main.ts`）

本計画の閾値・判定条件は下記コードを根拠とする。

| 区分 | 値/仕様 | 根拠 |
| --- | --- | --- |
| Pitch note-on confidence | `PITCH_ON_CONFIDENCE = 0.82` | `src/main.ts:82` |
| Pitch note-off confidence | `PITCH_OFF_CONFIDENCE = 0.55` | `src/main.ts:83` |
| latency offset 許容範囲 | `-150 .. 150 ms` | `src/main.ts:35`, `src/main.ts:36`, `src/main.ts:136` |
| latency offset UI 範囲 | `min=-150`, `max=150`, `step=1` | `src/ui/index.ts:229`, `src/ui/index.ts:230`, `src/ui/index.ts:231` |
| Diagnostics 集計項目 | `lane fps avg`, `meter hz avg`, `audio delay avg`, `audio delay p95`, `estimated latency` | `src/main.ts:206`, `src/main.ts:207`, `src/main.ts:208`, `src/main.ts:209`, `src/main.ts:214` |
| estimated latency 計算 | `baseLatencyMs + audioDelayAvgMs`（base 未取得時は audioDelayAvg のみ） | `src/main.ts:211` |
| audio delay サンプル処理 | `0..1000ms` へ clamp、保持上限 `240` | `src/main.ts:38`, `src/main.ts:39`, `src/main.ts:40`, `src/main.ts:270`, `src/main.ts:272` |

補足:

- pitch note on/off の安定化フレームは `NOTE_ON_STABLE_FRAMES=2`, `NOTE_OFF_STABLE_FRAMES=3`（`src/main.ts:84`, `src/main.ts:85`）。
- latency offset 永続化キーは `rifflane.latencyOffsetMs`（`src/scoring/latency-offset-storage.ts:3`）。

## 3. 前提環境

### 3.1 テスト対象環境

| 区分 | 必須条件 |
| --- | --- |
| Windows | Windows 11（推奨）または Windows 10。USB マイクまたはオーディオ IF を接続。 |
| Chrome (Desktop) | Chrome Stable 64-bit。マイク権限を「許可」。 |
| Android | Android 13 以上の実機 + Chrome Stable。USB デバッグ有効。 |
| 接続 | 同一 LAN でのアクセス、または USB 経由 `adb reverse`。 |
| 実行 | `npm ci` 後に `npm run dev -- --host 0.0.0.0 --port 5173`。 |

### 3.2 Android 接続手順（最小）

1. PC で開発サーバを起動する。`npm run dev -- --host 0.0.0.0 --port 5173`
2. USB 接続後、ポートを転送する。`adb reverse tcp:5173 tcp:5173`
3. Android Chrome で `http://127.0.0.1:5173` を開く。
4. Chrome のサイト設定でマイク権限を許可する。

## 4. 観測対象 `data-role` とメトリクス

### 4.1 オーディオ入力・権限

| data-role | メトリクス/表示 | 単位 | 用途 |
| --- | --- | --- | --- |
| `status-value` | 入力状態文言 | text | 初期化/稼働/失敗の確認 |
| `sample-rate-value` | サンプルレート | Hz | デバイス妥当性 |
| `channel-count-value` | チャンネル数 | ch | モノラル/ステレオ確認 |
| `base-latency-value` | base latency | sec | 推定遅延算出の入力 |
| `constraints-value` | echo/noise/agc | on/off/n/a | 制約の適用確認 |
| `meter-update-hz-value` | メーター更新周波数 | Hz | 連続更新性 |
| `rms-level-value` | RMS レベル | dBFS | 入力レベル |
| `peak-level-value` | Peak レベル | dBFS | クリップ傾向 |

### 4.2 Pitch・採点

| data-role | メトリクス/表示 | 単位 | 用途 |
| --- | --- | --- | --- |
| `pitch-f0-hz-value` | 推定基本周波数 | Hz | pitch 推定確認 |
| `pitch-midi-note-value` | 推定 MIDI note | note / number | 音高識別確認 |
| `pitch-cents-error-value` | cents 誤差 | cents | 音程ずれ確認 |
| `pitch-confidence-value` | confidence | 0.00-1.00 | on/off 閾値判定 |
| `pitch-note-tracking-state-value` | `off/arming/note on/release-hold/transition` | text | gate 状態確認 |
| `latest-judgment-value` | 最新判定 | enum | 判定イベント発火確認 |
| `stats-perfect-value` | Perfect 数 | count | 採点結果 |
| `stats-good-value` | Good 数 | count | 採点結果 |
| `stats-miss-value` | Miss 数 | count | 採点結果 |
| `stats-accuracy-value` | Accuracy | % | 合否判定 |

### 4.3 Latency・Diagnostics

| data-role | メトリクス/表示 | 単位 | 用途 |
| --- | --- | --- | --- |
| `latency-offset-slider` | latency offset 入力 | ms | 較正操作 |
| `latency-offset-value` | latency offset 表示 | ms | 範囲/永続化確認 |
| `diagnostics-toggle` | diagnostics ON/OFF | bool | 指標表示制御 |
| `diagnostics-mode-value` | diagnostics 状態 | `ON/OFF` | モード状態 |
| `diagnostics-panel` | diagnostics 表示領域 | aria-hidden | 表示有無 |
| `diagnostics-lane-fps-avg-value` | lane fps avg | fps | 描画性能 |
| `diagnostics-meter-hz-avg-value` | meter hz avg | Hz | audio update 性能 |
| `diagnostics-audio-delay-avg-value` | audio delay avg | ms | 平均遅延 |
| `diagnostics-audio-delay-p95-value` | audio delay p95 | ms | 遅延ばらつき |
| `diagnostics-estimated-latency-value` | estimated latency | ms | 較正初期値 |

## 5. シナリオ別手順と合格基準

### 5.1 判定基準（共通）

- 計測窓は原則 30 秒以上（性能確認は 180 秒）。
- 小数点は UI 表示値をそのまま記録する（四捨五入はしない）。
- Android はバックグラウンド制限の影響を受けるため、画面 ON を維持する。

### 5.2 テストケース

| ID | シナリオ | 手順（要約） | 合格基準（数値） |
| --- | --- | --- | --- |
| `AIT-01` | 音声キャプチャ開始 | デバイス更新→入力デバイス選択→`開始` | 1) `status-value` が 5 秒以内に「ストリーム稼働中...」系文言へ遷移 2) `sample-rate-value >= 16000 Hz` 3) `meter-update-hz-value >= 20.0 Hz`（10 秒連続） |
| `AIT-02` | レベルメーター応答 | 10 秒無音→10 秒発声/単音 | 1) 無音時 `rms-level-value <= -45 dBFS`（7/10 秒以上） 2) 発声音で `rms-level-value` が無音時より `+12 dB` 以上上昇 3) `peak-level-value <= 0 dBFS` |
| `AIT-03` | Pitch gate/hysteresis | 単音を 2 秒保持→停止を 2 秒、これを 5 回 | 1) `pitch-confidence-value >= 0.82` 到達後に `pitch-note-tracking-state-value` が 300ms 以内に `note on` 2) 停止後、`pitch-confidence-value < 0.55` の継続で 400ms 以内に `off`（または `release-hold` 経由） 3) `pitch-confidence-value < 0.82` のみでは `note on` に固定遷移しない |
| `AIT-04` | 採点イベント連動 | lane 再生 (`1.0x`) + 30 秒演奏 | 1) `latest-judgment-value` が 10 回以上更新 2) `stats-perfect + stats-good + stats-miss >= 10` 3) `stats-accuracy-value >= 60.0%`（較正済み条件） |
| `AIT-05` | Diagnostics 性能 | diagnostics ON で 180 秒連続実行 | 1) Windows: `diagnostics-lane-fps-avg-value >= 50.0`、Android: `>= 28.0` 2) `diagnostics-meter-hz-avg-value >= 20.0` 3) Windows: `audio-delay-avg <= 120ms` かつ `p95 <= 200ms`、Android: `avg <= 220ms` かつ `p95 <= 320ms` |
| `AIT-06` | latency offset 境界/永続化 | offset を `-150`/`+150` に設定、再読込、localStorage 強制値投入 | 1) `latency-offset-value` が `-150ms` と `+150ms` を表示 2) 再読込後に最終値を維持 3) `localStorage['rifflane.latencyOffsetMs']='999'` 後に再読込すると `+150ms` に clamp、`'-999'` で `-150ms` |

## 6. Latency offset 較正手順

### 6.1 目的

端末固有遅延に合わせて `latency offset` を設定し、採点精度を安定化する。

### 6.2 実施手順

1. `AIT-01` を完了し、入力が安定している状態にする。
2. diagnostics を ON にし、30 秒ウォームアップする。
3. `diagnostics-estimated-latency-value` を 1 秒間隔で 10 点記録し、平均 `E` を算出する。
4. 初期 offset を `O0 = clamp(round(-E), -150, 150)` とする。
5. 候補集合 `O = {O0-20, O0-10, O0, O0+10, O0+20}`（各値を `-150..150` に clamp）を作る。
6. 各候補で 20 秒ずつ演奏し、`Perfect/Good/Miss` を記録する。
7. 評価値 `Score = Perfect + 0.5*Good - 0.5*Miss` を計算し、最大の offset を採用する。
8. 採用 offset で 60 秒再検証し、`stats-accuracy-value` を記録する。

### 6.3 較正合格基準

- 採用 offset が `-150..150 ms` の範囲内であること。
- 再検証 60 秒で `stats-accuracy-value >= 70.0%`。
- `stats-miss-value / 総判定数 <= 25.0%`。

## 7. 証跡取得（スクリーンショット / ログ）

### 7.1 スクリーンショット必須点

保存先推奨: `artifacts/audio-it/<YYYYMMDD>/`

| 証跡ID | 取得タイミング | 必須要素 |
| --- | --- | --- |
| `SS-01` | デバイス更新直後 | `status-value`, `device-select` |
| `SS-02` | キャプチャ開始後 10 秒 | `status-value`, `sample-rate-value`, `rms/peak`, `meter-update-hz-value` |
| `SS-03` | 単音入力で confidence 高値時 | `pitch-confidence-value`, `pitch-note-tracking-state-value` |
| `SS-04` | diagnostics ON で 180 秒計測後 | diagnostics 5 指標 |
| `SS-05` | latency offset 境界値設定時 | `latency-offset-slider`, `latency-offset-value` |
| `SS-06` | 再読込直後 | 永続化された `latency-offset-value` |

### 7.2 ログ必須点

- Chrome DevTools Console で以下を実行し、30 秒のスナップショットを JSON として保存する。

```javascript
const roles = [
  'status-value',
  'sample-rate-value',
  'meter-update-hz-value',
  'pitch-confidence-value',
  'pitch-note-tracking-state-value',
  'latest-judgment-value',
  'stats-perfect-value',
  'stats-good-value',
  'stats-miss-value',
  'stats-accuracy-value',
  'latency-offset-value',
  'diagnostics-lane-fps-avg-value',
  'diagnostics-meter-hz-avg-value',
  'diagnostics-audio-delay-avg-value',
  'diagnostics-audio-delay-p95-value',
  'diagnostics-estimated-latency-value',
]

const rows = []
let count = 0
const timer = setInterval(() => {
  const row = { ts: new Date().toISOString() }
  for (const role of roles) {
    row[role] = document.querySelector(`[data-role="${role}"]`)?.textContent?.trim() ?? null
  }
  rows.push(row)
  count += 1
  if (count >= 30) {
    clearInterval(timer)
    console.log(JSON.stringify(rows, null, 2))
  }
}, 1000)
```

- Android 実機は追加で `adb logcat -d > android-logcat.txt` を保存する。

## 8. 結果記録テンプレート

### 8.1 実行サマリー

| 項目 | 記録値 |
| --- | --- |
| 実行日 |  |
| 実行者 |  |
| Git commit |  |
| Node.js / npm |  |
| OS / 端末 |  |
| Chrome version |  |
| マイク機材 |  |
| 実行シナリオ | `AIT-01..06` |
| 総合判定 | `Pass / Fail` |
| 備考 |  |

### 8.2 ケース別結果

| Case ID | Pass/Fail | 実測値（主要） | しきい値 | 差分/所見 | 証跡ID |
| --- | --- | --- | --- | --- | --- |
| AIT-01 |  |  |  |  |  |
| AIT-02 |  |  |  |  |  |
| AIT-03 |  |  |  |  |  |
| AIT-04 |  |  |  |  |  |
| AIT-05 |  |  |  |  |  |
| AIT-06 |  |  |  |  |  |

### 8.3 Latency 較正記録

| 候補 offset (ms) | Perfect | Good | Miss | Score = P + 0.5G - 0.5M |
| --- | --- | --- | --- | --- |
|  |  |  |  |  |
|  |  |  |  |  |
|  |  |  |  |  |
|  |  |  |  |  |
|  |  |  |  |  |

採用 offset: `____ ms`  
再検証 Accuracy: `____ %`  
再検証 Miss率: `____ %`
