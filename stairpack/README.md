# StairPack（Studio One 階段テイクまとめ）

Studio One で歌を録ると、`main 1`〜`main 21` のように少しずつ重なったテイクが階段状に並ぶ。
これを **重ならない範囲で最小本数のトラックに詰める** Studio One 用スクリプト。

- 音は一切切らない（重なっている所だけ2本目・3本目に逃がす）
- トラックごとミュートしているトラック（NGテイク）は触らない
- テイク（レイヤー）を複数持つトラックも触らない
- 中身が空になったトラックは削除する
- 実行ログを `ドキュメント\Studio One\stairpack_log.txt` に書き出す

## インストール（Studio One 5.5 / Windows）

1. Studio One を終了する
2. `dist/StairPack.package` を `C:\Program Files\PreSonus\Studio One 5\Scripts\` にコピー（管理者の確認が出たら「続行」）
3. Studio One を起動する

※ Studio One をアップデートすると Scripts フォルダが上書きされることがあるので、その時は入れ直す。

## 使い方

1. トラックリストで、まとめたいトラック（例: `main 1` をクリック → `main 21` を Shift+クリック）を選択
2. 選択したトラックを右クリック →「階段テイクをまとめる」
   - 「階段テイクをまとめる（診断のみ）」は、何も変更せずに何本にまとまるかだけ表示する
3. 結果がポップアップで出る。元に戻すときは Ctrl+Z

## しくみ

- 選択トラックの全イベントを開始位置順に並べ、区間スケジューリング（first-fit）でレーンに割り当てる。
  同じ元トラックの続きのイベントは、なるべく同じレーンに置く。
- レーン数 = 同時に重なっているテイク数の最大値（＝理論上の最小本数）。
- レーンには、選択トラックのうち上から順に（ミュート中でない）既存トラックを使う。
- イベントの移動には Studio One 内部スクリプトAPIの `functions.transferEvent` を使う。Studio One 5.5 では移動したイベントが曲の先頭(0秒)に置かれるため、直後に `functions.moveEvent` で元の位置に戻す。
  移動のたびに移動先・移動元を走査して本当に移動できたか確認する。確認できなければその時点で止める。

## 注意

Studio One のスクリプトAPIは公式に公開されていない（コミュニティが解析したもの）。
同梱スクリプトや [Studio Pro Scripting API Reference](https://github.com/CSources/Studio-Pro-Scripting-API-Reference) を参考にしている。

## 開発メモ

- `package/` … パッケージの中身（`stairpack.js`, `classfactory.xml`, `metainfo.xml`）
- `tools/build.py` … `dist/StairPack.package`（ZIP）を作る。JSの日本語は `\uXXXX` にエスケープ
- `tools/song_to_json.py` … `.song` からトラック・イベント一覧（秒）を取り出す（テストデータ作成用）
- `test/run_test.js` … Studio One API のモックで丸ごと動かすテスト
  - `node test/run_test.js test/eva_screenshot.json "^main \d+$" "main 4,main 5,main 17,main 18,main 21"`
  - `node test/run_test.js test/eva_screenshot.json "^main \d+$" "" --no-transfer`（移動手段が無い環境で何も変えずに止まるか）

### 調べて分かったこと

- `.song` は ZIP。`Song/song.xml` の `MediaTrack > List[x:id=Events] > AudioEvent` がイベント。
  `timeFormat="2"` の値は拍（四分音符）、`"0"` は秒。テンポは `TempoMapSegment@tempo`（1拍あたり秒）。
- Studio One 5.5 同梱の `.package` は ZIP ではなく `PACKAGEF` 形式（zlib圧縮ストリーム＋末尾にUTF-16のファイル表）。
  ただしユーザー作成の ZIP 形式 `.package` も読み込まれる（コミュニティ報告）。
- DAWproject 形式は Studio One 6.5 Professional 以降のみ。
