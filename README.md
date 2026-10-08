# 議事録

明治期の法典編纂に関わる会議（法律取調委員会・法典調査会など）の議事録の本文を、原本画像と並べて読む静的サイト。
原本画像は国立国会図書館デジタルコレクションの IIIF から表示する（GitHub Pages でそのまま公開できる）。

## 構成

```
minutes/index.html     議事録一覧（分野 > 会議体 > 各回）
minutes/<議事録>.html  各回の本文。議題ごとの「原本 →」から原本画像を並べて表示する
minutes/style.css      見た目（明治法律辞書検索 juridic と共通の作り）
minutes/minutes.js     原本画像ビューア（OpenSeadragon で IIIF 画像を表示し、スクロールに連動させる）
```

`minutes/` の中身はすべて、このリポジトリの外にある変換プログラム
`arthis/program/convert_minutes_to_html.ps1` が、元データ `arthis/data/minutes/*.xml`（TEI）から生成する。
一覧の階層（どの議事録をどの分野・会議体に入れるか）は `arthis/data/minutes_index.json` で定める。

## データの更新

`arthis/data/minutes/` の TEI や `arthis/data/minutes_index.json` を変えたら、`arthis/` 直下で:

```
powershell -File program\convert_minutes_to_html.ps1
```

1 回分だけ確かめるときは `-Only <出力ファイル名>`（例: `-Only 129a0089_1_g18960701_180.html`）を付ける。
