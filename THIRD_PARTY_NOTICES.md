# 外部のコードの記録（THIRD_PARTY_NOTICES）

QwenChat が外部から取って使った物・知見を借りた物の記録です。

## three 0.186.1
- 出どころ: https://www.npmjs.com/package/three
- 取った物: npm:three@0.186.1（指紋 sha256 8cd068708ea44f2c）
- ライセンス: MIT（ゆるい）
- 使い方: そのまま転用（ファイルを写した）
- 義務: 作者名とライセンス文を残せば、写して使ってよい（THIRD_PARTY_NOTICES に記録）
- 用途と利用条件: 個人で使う（配らない） → 可（作者名（著作権表示）とライセンス文を残す）
- 理由: 3D 描画の基盤として必要。build/three.module.js と build/three.core.js のみを使用。
- 検査: 注意（異常なし）
- 日時: 2026-10-20 23:29
- ファイル: build/three.module.js → app/static/3d/lib/three.module.js, build/three.core.js → app/static/3d/lib/three.core.js

## letele/playing-cards 865a78eb940c1232e4b21523577c8fca52f694fe
- 出どころ: https://github.com/letele/playing-cards
- 取った物: github:letele/playing-cards@865a78eb940c1232e4b21523577c8fca52f694fe（指紋 sha256 ada613ec50a0d491）
- ライセンス: CC0-1.0（ゆるい）
- 使い方: そのまま転用（ファイルを写した）
- 義務: 作者名とライセンス文を残せば、写して使ってよい（THIRD_PARTY_NOTICES に記録）
- 用途と利用条件: 個人で使う（配らない） → 可（作者名（著作権表示）とライセンス文を残す）
- 理由: 外部コード（EXT-20261020-232201-9bbffdbf）から、CC0 の_playing-cards_の SVG ファイルをプロジェクトに転用します。
- 検査: 安全（異常なし）
- 日時: 2026-10-21 16:46
- ファイル: assets/B-1.svg → app/static/3d/assets/B-1.svg, assets/B-2.svg → app/static/3d/assets/B-2.svg, assets/C-10.svg → app/static/3d/assets/C-10.svg, assets/C-2.svg → app/static/3d/assets/C-2.svg, assets/C-3.svg → app/static/3d/assets/C-3.svg, assets/C-4.svg → app/static/3d/assets/C-4.svg, assets/C-5.svg → app/static/3d/assets/C-5.svg, assets/C-6.svg → app/static/3d/assets/C-6.svg, assets/C-7.svg → app/static/3d/assets/C-7.svg, assets/C-8.svg → app/static/3d/assets/C-8.svg, assets/C-9.svg → app/static/3d/assets/C-9.svg, assets/C-A.svg → app/static/3d/assets/C-A.svg, assets/C-J.svg → app/static/3d/assets/C-J.svg, assets/C-K.svg → app/static/3d/assets/C-K.svg, assets/C-Q.svg → app/static/3d/assets/C-Q.svg, assets/D-10.svg → app/static/3d/assets/D-10.svg, assets/D-2.svg → app/static/3d/assets/D-2.svg, assets/D-3.svg → app/static/3d/assets/D-3.svg, assets/D-4.svg → app/static/3d/assets/D-4.svg, assets/D-5.svg → app/static/3d/assets/D-5.svg, assets/D-6.svg → app/static/3d/assets/D-6.svg, assets/D-7.svg → app/static/3d/assets/D-7.svg, assets/D-8.svg → app/static/3d/assets/D-8.svg, assets/D-9.svg → app/static/3d/assets/D-9.svg, assets/D-A.svg → app/static/3d/assets/D-A.svg, assets/D-J.svg → app/static/3d/assets/D-J.svg, assets/D-K.svg → app/static/3d/assets/D-K.svg, assets/D-Q.svg → app/static/3d/assets/D-Q.svg, assets/H-10.svg → app/static/3d/assets/H-10.svg, assets/H-2.svg → app/static/3d/assets/H-2.svg, assets/H-3.svg → app/static/3d/assets/H-3.svg, assets/H-4.svg → app/static/3d/assets/H-4.svg, assets/H-5.svg → app/static/3d/assets/H-5.svg, assets/H-6.svg → app/static/3d/assets/H-6.svg, assets/H-7.svg → app/static/3d/assets/H-7.svg, assets/H-8.svg → app/static/3d/assets/H-8.svg, assets/H-9.svg → app/static/3d/assets/H-9.svg, assets/H-A.svg → app/static/3d/assets/H-A.svg, assets/H-J.svg → app/static/3d/assets/H-J.svg, assets/H-K.svg → app/static/3d/assets/H-K.svg

## @tweenjs/tween.js 25.0.0
- 出どころ: https://www.npmjs.com/package/@tweenjs/tween.js
- 取った物: npm:@tweenjs/tween.js@25.0.0（指紋 sha256 3adc6badf9071b9a）
- ライセンス: MIT（ゆるい）
- 使い方: そのまま転用（ファイルを写した）
- 義務: 作者名とライセンス文を残せば、写して使ってよい（THIRD_PARTY_NOTICES に記録）
- 用途と利用条件: 個人で使う（配らない） → 可（作者名（著作権表示）とライセンス文を残す）
- 理由: 外部コード（EXT-20261020-232946-cfb22894）から、MIT ライセンスの @tweenjs/tween.js をプロジェクトに転用します。
- 検査: 安全（異常なし）
- 日時: 2026-10-21 16:46
- ファイル: dist/tween.esm.js → app/static/3d/lib/tween.esm.js

## stretch_poplin files_hash 040e1a500b3ee71a0b19c9df47054db76955fd82・1k
- 出どころ: https://polyhaven.com/a/stretch_poplin
- 取った物: polyhaven:stretch_poplin（指紋 sha256 ）
- ライセンス: CC0-1.0（ゆるい）
- 使い方: そのまま転用（ファイルを写した）
- 義務: 作者名とライセンス文を残せば、写して使ってよい（THIRD_PARTY_NOTICES に記録）
- 用途と利用条件: 個人で使う（配らない） → 可（作者名（著作権表示）とライセンス文を残す）
- 理由: 外部コード（EXT-20261020-214304-4943a83d）から、Poly Haven の CC0 のフェルトテクスチャをプロジェクトに転用します。
- 検査: 安全（異常なし）
- 日時: 2026-10-21 16:46
- ファイル: stretch_poplin_diff_1k.jpg → app/static/3d/assets/stretch_poplin_diff_1k.jpg, stretch_poplin_rough_1k.jpg → app/static/3d/assets/stretch_poplin_rough_1k.jpg, stretch_poplin_nor_gl_1k.jpg → app/static/3d/assets/stretch_poplin_nor_gl_1k.jpg, stretch_poplin_ao_1k.jpg → app/static/3d/assets/stretch_poplin_ao_1k.jpg, stretch_poplin_arm_1k.jpg → app/static/3d/assets/stretch_poplin_arm_1k.jpg

## howler 2.2.4
- 出どころ: https://www.npmjs.com/package/howler
- 取った物: npm:howler@2.2.4（指紋 sha256 be9d8d09345954e2）
- ライセンス: MIT（ゆるい）
- 使い方: そのまま転用（ファイルを写した）
- 義務: 作者名とライセンス文を残せば、写して使ってよい（THIRD_PARTY_NOTICES に記録）
- 用途と利用条件: 個人で使う（配らない） → 可（作者名（著作権表示）とライセンス文を残す）
- 理由: 会長の追加要件（BGM と効果音）。ブラウザの音の再生は、スマホの自動再生の制限・最初の操作での解除・音量の管理・同時再生の扱いが要るので、実績のある howler.js（MIT）を使う。自分で書くより確か。
- 検査: 安全（異常なし）
- 日時: 2026-10-22 00:21
- ファイル: dist/howler.core.min.js → app/static/3d/lib/howler.core.min.js, LICENSE.md → third_party_licenses/howler.txt

## iminurnamez/pyroller 13a3fcac97773c162ca54e0fab1c6bbccd715744
- 出どころ: https://github.com/iminurnamez/pyroller
- 取った物: github:iminurnamez/pyroller（指紋 sha256 b71f57f8d393eda5）
- ライセンス: 不明（不明）
- 使い方: 知見を借りた（読んで参考にし、コードは自分で書いた）
- 義務: ライセンスが分からない（無い）＝作者の許可がない。写して使わない。知見を借りる（読んで自分で書く）まで
- 用途と利用条件: 個人で使う（配らない） → 不可（ライセンスが無い／分からない＝作者の許可が無い。そのまま写さない（知見を借りるまで））
- 理由: CC0 の音源の出どころとして参照（Py Rollers Casino は README で CC-0 を宣言。attribution.txt と resources/sound/CREDITS.txt に各音源のライセンスがある）。写す物は Claude が個別にライセンスを確かめて THIRD_PARTY_NOTICES に記録する。
- 検査: 安全（異常なし）
- 日時: 2026-10-22 00:21

## 音源（会長の追加要件：BGM と効果音。Claude が 2026-10-22 00:2x に個別に確かめて写した）
- 出どころ: github:iminurnamez/pyroller@13a3fcac97773c162ca54e0fab1c6bbccd715744（Py Rollers Casino。README で「CC-0 project」と宣言。各音源の出どころは attribution.txt・resources/sound/CREDITS.txt）。QwenChat の code_fetch で隔離箱 EXT-20261022-001920-997f665e に取り、code_scan は「安全」。作品全体の LICENSE ファイルが無いため道具の判定は「ライセンス不明」だったので、写す物は Claude が attribution.txt で 1 つずつ確かめた（下の物だけ。freesound 由来で条件が書かれていない bingo-* は使わない）。
- ライセンス: CC0-1.0（ゆるい）。写し: third_party_licenses/pyroller_audio_CC0.txt（attribution.txt と CREDITS.txt の原文）
- 使い方: そのまま転用（wav/ogg → mp3 に変換して app/static/3d/audio/ に置いた。iPhone の Safari でも鳴るように）
- 用途と利用条件: 個人・同じ Wi-Fi で使う（配らない） → 可
- 写した物:
  - 札の音（Kenney www.kenney.nl・CC0・「54 casino sound effects」）: cardplace2/3/4（出札）、cardshove1/3（シャッフル・場が流れる）、cardslide2/3（配札・パス）、chipsstack3/5
  - 操作音（lokif・opengameart.org/content/gui-sound-effects・CC0）: positive、negative（不正な操作）、misc_menu_4（札の選択）
  - BGM: main_stem.ogg → audio/main_stem.mp3（「Main Stem」。演奏 U.S. Army Blues・attribution.txt で CC-0。作曲は Duke Ellington（1942）なので、曲そのものの権利は演奏の CC0 とは別に残り得る。個人で使う範囲に留める）
  - BGM: gospel_truth.ogg → audio/gospel_truth.mp3（「The Gospel Truth」作曲 Craig Friedrich・演奏 U.S. Army Blues・CC-0）
- 使わなかった物: betcha_nickel ほか「public domain と思われる」と書かれた歌入りの録音（権利が確かでない）、bingo-*（freesound 由来で条件の記載なし）
- 合成した音（既存の音源が無い物。Web Audio で短く作った・権利の問題なし）: 自分の手番の知らせ、革命／8切り・スペ3返しの演出音、上がり、ラウンド終了のファンファーレ
- 再生の実装: howler 2.2.4（MIT・上の記録のとおり code_adopt で転用。app/static/3d/lib/howler.core.min.js、third_party_licenses/howler.txt）
