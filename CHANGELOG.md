# 変更履歴

このファイルは、このプロジェクトの主な変更を記録します。

フォーマットは [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/) に準拠し、
バージョニングは [Semantic Versioning](https://semver.org/lang/ja/) を採用します。

## [Unreleased]

### Added
- `Vitest` による unit test 基盤を追加（`src/chart/midi.test.ts`, `src/scoring/engine.test.ts`）。
- `Playwright` による e2e test 基盤を追加（`tests/e2e/app.spec.ts`）。
- 診断モードを追加し、lane FPS 平均・meter 更新Hz平均・AudioWorklet遅延（avg/p95）・推定遅延を表示。
- バージョニング方針ドキュメント `docs/versioning-policy.md` を追加。
- `scoring` 領域の追加 unit test を作成（`config/pitch/adapters/latency-offset-storage`）。
- テスト戦略ドキュメント `docs/testing-guide.md` を追加。
- unit coverage 実行スクリプト `test:unit:coverage` を追加し、`README.md` と `docs/testing-guide.md` に実行手順・出力先（`coverage/`）を追記。
- `@vitest/coverage-v8` を追加し、`test:unit:coverage` を実行可能化。
- `lane-scroller` の unit test を追加（`src/ui/lane-scroller.test.ts`）。
- `chart` 変換ロジックの unit test を拡張（`src/chart/midi.test.ts`: BPM fallback / options / 補助関数群）。
- `engine` の追加 unit test を拡張（候補選択分岐、無効チャート入力）。
- `lane-scroller` の unit test をさらに拡張（2D context欠如、`setTransform` 分岐、FPS callback解除）。

### Changed
- CI を `verify`（lint/typecheck/unit/build）と `e2e`（Playwright）へ分離。
- `.gitignore` に `test-results` / `playwright-report` を追加。
- `README.md` にリリース管理ドキュメント参照を追加。
- e2e に `localStorage` 永続化検証（latency offset / diagnostics mode reload 復元）を追加。
- `.gitignore` に `coverage/` を追加。
- unit coverage を改善（全体 `Statements 94.93% / Branches 85.03% / Functions 94.79% / Lines 95.01%`）。

## [0.1.0] - 2026-02-20

### 追加
- Vite + TypeScript ベースの検証用 UI を初期リリースとして提供。
- `.mid/.midi` の読み込み、トラック選択、E/A/D/G（4弦ベース）へのマッピングを含む MIDI import 機能を実装。
- `getUserMedia` と `AudioWorkletNode` を利用した audio capture、RMS/Peak メーター、YIN pitch 推定（35Hz-200Hz）を実装。
- 4 レーンスクロール表示と `Perfect/Good/Miss` 判定、採点統計表示を実装。
- latency offset（`-150ms` から `+150ms`）の調整と `localStorage` 永続化を実装。
- `lint`、`typecheck`、`build`、`test:unit`、`test:e2e` の検証コマンドを整備。
