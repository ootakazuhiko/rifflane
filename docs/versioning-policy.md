# バージョニング方針

このプロジェクトは [Semantic Versioning 2.0.0](https://semver.org/lang/ja/) を前提とし、`vMAJOR.MINOR.PATCH` 形式の Git タグでリリースを管理します。

## バージョン番号の判定基準

- `MAJOR`:
  - 後方互換性を壊す変更を含む場合に更新します。
  - 例: 既存の利用手順や外部向け仕様で、従来どおり動作しない変更。
- `MINOR`:
  - 後方互換性を維持した機能追加を行う場合に更新します。
  - 例: 新機能追加、既存機能に影響しないオプション追加。
- `PATCH`:
  - 後方互換性を維持した不具合修正や軽微改善の場合に更新します。
  - 例: バグ修正、性能改善、文書修正。

## プレリリース運用

- プレリリース識別子は `-alpha.N`、`-beta.N`、`-rc.N` を使用します（例: `v0.2.0-rc.1`）。
- 同一ターゲット版に対して、`alpha -> beta -> rc -> 正式版` の順で昇格します。
- プレリリース中の変更も `CHANGELOG.md` の `Unreleased` に集約し、正式リリース時に確定版セクションへ移動します。

## リリース手順（要約）

1. リリース対象変更を確定し、`MAJOR/MINOR/PATCH` のどれを上げるか判定する。
2. `CHANGELOG.md` の `Unreleased` を対象バージョン節（例: `## [0.2.0] - 2026-02-20`）へ反映する。
3. バージョン番号を更新する（例: `npm version 0.2.0 --no-git-tag-version`）。
4. 品質確認を実行する（例: `npm run lint && npm run typecheck && npm run test:unit && npm run test:e2e && npm run build`）。
5. リリースコミット作成後、注釈付きタグを付与する（例: `git tag -a v0.2.0 -m \"Release v0.2.0\"`）。
6. コミットとタグを同時に push する（例: `git push origin HEAD --follow-tags`）。
