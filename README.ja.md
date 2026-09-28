<p align="center">
  <h1 align="center">FHIRBridge</h1>
  <p align="center">
    <strong>病院・クリニックのためのオープンソース患者データ・ポータビリティツール</strong><br/>
    自組織で運用し、HIS からデータを取得して FHIR R4 で出力、AI 要約(任意)を生成します。患者データは保存しません。
  </p>
  <p align="center">
    <a href="README.md">English</a> &bull;
    <a href="README.vi.md">Tiếng Việt</a> &bull;
    <a href="README.ko.md">한국어</a> &bull;
    <b>日本語</b>
  </p>
</p>

---

> 日本語のクイックスタートです。API、セキュリティ、デプロイ、環境変数などの完全なドキュメントは
> [README.md](README.md)(英語)をご覧ください。

## FHIRBridge とは

患者の診療記録は各医療機関の病院情報システム(HIS)に閉じ込められています。**FHIRBridge** は
FHIR API または CSV/Excel で HIS に接続し、データを標準の **FHIR R4** バンドルに変換します。
必要に応じて匿名化したうえで AI 要約を生成します。すべての処理は貴院のインフラ上で実行されます。

**SaaS・課金・利用上限はありません。** リポジトリを取得して自分で実行します。病院・クリニックが
運用者であり、個人情報取扱事業者です。

## クイックスタート

次のいずれかを選んでください。どちらも **http://localhost:8080** で Web UI が開き、架空の患者
(ベトナム・韓国・日本・米国)を収録した **デモ HIS** が同時に起動するため、実際の HIS や
インターネット接続がなくてもエクスポートを試せます。

### 方法 A — Node.js(Windows / macOS / Linux)

Node.js 20 以上と pnpm 9 以上が必要です(`corepack enable` で pnpm を導入できます)。

```bash
git clone https://github.com/Digital-Healthcare-OpenSource/FHIRBridge.git
cd FHIRBridge
pnpm install
pnpm run setup     # .env を作成(ランダムなシークレット + API キー)し、全体をビルド
pnpm demo          # API + Web UI + デモ HIS → http://localhost:8080
```

> `pnpm setup` ではなく `pnpm run setup` です(`pnpm setup` は pnpm の組み込みコマンドです)。

### 方法 B — Docker(ホストに Node.js は不要)

```bash
git clone https://github.com/Digital-Healthcare-OpenSource/FHIRBridge.git
cd FHIRBridge
# 使い捨ての Node コンテナで .env(ランダムなシークレット + API キー)を作成
docker run --rm -v "$PWD":/app -w /app node:20-alpine node scripts/setup.mjs --env-only
docker compose --profile demo up --build     # → http://localhost:8080
```

デモ HIS が不要な場合は `--profile demo` を外してください。

### 初めてのエクスポート(共通)

1. **http://localhost:8080** → **設定(Settings)** で API キー(`.env` の `API_KEYS=` 行の値。
   漏えい防止のためセットアップはキーを画面に表示しません)を貼り付けて **設定を保存** を押します。
   キーはブラウザのメモリ内にのみ保持されます。
2. 言語切り替えメニューで表示言語(日本語 / English / 한국어 / Tiếng Việt)を選びます。
3. **データエクスポート** → **FHIR エンドポイント** → サーバー URL を入力
   - `pnpm demo` の場合: `http://localhost:8090/fhir`
   - Docker のデモプロファイルの場合: `http://demo-his:8090/fhir`
4. 患者 ID `demo-jp-001`(または `demo-vn-001`、`demo-kr-001`、`demo-en-001`)→ エクスポート
   開始 → FHIR R4 バンドル(JSON または NDJSON)をダウンロード。
5. **データインポート** → 日本のカラムマッピング例を選択 → **サンプルデータで試す** → **インポート** →
   CSV / Excel から作成された FHIR バンドルをダウンロード。

インストールの動作確認はいつでも `pnpm smoke` で行えます(ヘルスチェック → HIS 接続 → エクスポート →
ダウンロード。Docker デモの場合: `pnpm smoke --his http://demo-his:8090/fhir`)。

### 実際の HIS への接続

SSRF 対策として、プライベート/ループバックアドレス(10.x、172.16.x、192.168.x、localhost)は
既定で **ブロック** されます。HIS は通常院内ネットワークにあるため、`.env` で明示的に許可してから
`pnpm start`(または `docker compose up`)で起動してください。

```bash
# ホスト名、IPv4 アドレス、IPv4 CIDR、または host:port をカンマ区切りで指定
CONNECTOR_ALLOWED_HOSTS=his.hospital.local,10.20.0.0/16
```

クラウドのメタデータアドレス(169.254.0.0/16、`metadata.google.internal` など)は、指定しても
常にブロックされます。HIS から CSV/Excel で出力する場合は [カラムマッピングの説明](examples/README.md)
と、日本のクリニック向けの例 [excel-japan-clinic.json](examples/column-mappings/excel-japan-clinic.json)
をご覧ください。

## CLI の使い方

```bash
# FHIR エンドポイントからエクスポート(院内/localhost のアドレスは許可リストが必要)
CONNECTOR_ALLOWED_HOSTS=localhost:8090 \
  pnpm fhirbridge export --patient-id demo-jp-001 --endpoint http://localhost:8090/fhir --output bundle.json

# CSV/Excel をカラムマッピングで FHIR バンドルに変換
pnpm fhirbridge import --file examples/data/jp-clinic.xlsx --mapping examples/column-mappings/excel-japan-clinic.json --output bundle.json

# FHIR バンドルの検証
pnpm fhirbridge validate --input bundle.json

# 日本語の AI 要約(送信前に匿名化。ANTHROPIC_API_KEY または OPENAI_API_KEY が必要)
export ANTHROPIC_API_KEY=...
pnpm fhirbridge summarize --input bundle.json --provider claude --language ja
```

## 個人情報保護法(APPI)について

AI 要約は **任意** の機能です。API キーを設定しなければ無効になり、エクスポートと CSV/Excel
取り込みはそのまま利用できます。

APPI では、仮名化したデータ(HMAC でハッシュ化した ID、シフトした日付)も依然として個人情報です。
要配慮個人情報を日本国外の AI 提供者に送信する場合、一般に移転先の国名を示した本人同意が必要です
(第 28 条)。日本での運用では、AI 要約を無効にするか、国内で推論が完結する提供者をご利用ください。
詳細は英語 README の [Data residency — Japan (APPI)](README.md#data-residency--japan-appi) を
ご覧ください。本書は技術的なガイダンスであり、**法的助言ではありません**。

## コントリビュート

日本語訳のレビュー、日本の HIS 向けカラムマッピング、不具合の報告を
[GitHub Issues](https://github.com/Digital-Healthcare-OpenSource/FHIRBridge/issues) で歓迎します。
[CONTRIBUTING.md](CONTRIBUTING.md) と [行動規範](CODE_OF_CONDUCT.md) をご確認のうえ、脆弱性は
[SECURITY.md](.github/SECURITY.md) に従って非公開でご報告ください。

ライセンス: [MIT](LICENSE)
