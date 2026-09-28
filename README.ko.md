<p align="center">
  <h1 align="center">FHIRBridge</h1>
  <p align="center">
    <strong>병원·의원을 위한 오픈소스 환자 데이터 이동성 도구</strong><br/>
    직접 운영하고, HIS에서 데이터를 가져와 FHIR R4로 내보내며, AI 요약(선택)을 생성합니다. 환자 데이터는 저장하지 않습니다.
  </p>
  <p align="center">
    <a href="README.md">English</a> &bull;
    <a href="README.vi.md">Tiếng Việt</a> &bull;
    <b>한국어</b> &bull;
    <a href="README.ja.md">日本語</a>
  </p>
</p>

---

> 한국어 빠른 시작 안내입니다. API, 보안, 배포, 환경 변수 등 전체 문서는
> [README.md](README.md)(영문)를 참고하십시오.

## FHIRBridge란?

환자의 진료기록은 각 병원의 병원정보시스템(HIS)에 갇혀 있습니다. **FHIRBridge**는 FHIR API
또는 CSV/Excel로 HIS에 연결하여 데이터를 표준 **FHIR R4** 번들로 변환하고, 필요하면
비식별화한 뒤 AI 요약을 생성합니다. 모든 처리는 귀 기관의 인프라에서 실행됩니다.

**SaaS도, 요금도, 사용량 제한도 없습니다.** 저장소를 내려받아 직접 실행합니다. 병원·의원이
운영자이자 개인정보처리자입니다.

## 빠른 시작

두 가지 방법 중 하나를 선택하십시오. 두 방법 모두 **http://localhost:8080** 에서 웹 UI를
열며, 가상 환자(베트남·한국·일본·미국)가 들어 있는 **데모 HIS**가 함께 실행되므로 실제 HIS나
인터넷 연결 없이도 내보내기를 바로 체험할 수 있습니다.

### 방법 A — Node.js (Windows / macOS / Linux)

Node.js 22 이상(24 LTS 권장), pnpm 9 이상이 필요합니다(`corepack enable`로 pnpm 설치).

```bash
git clone https://github.com/Digital-Healthcare-OpenSource/FHIRBridge.git
cd FHIRBridge
pnpm install
pnpm run setup     # .env 생성(무작위 시크릿 + API 키) 후 전체 빌드
pnpm demo          # API + 웹 UI + 데모 HIS → http://localhost:8080
```

> `pnpm setup`이 아니라 `pnpm run setup`입니다(`pnpm setup`은 pnpm 내장 명령입니다).

### 방법 B — Docker (호스트에 Node.js 불필요)

```bash
git clone https://github.com/Digital-Healthcare-OpenSource/FHIRBridge.git
cd FHIRBridge
# 일회용 Node 컨테이너로 .env(무작위 시크릿 + API 키) 생성
docker run --rm -v "$PWD":/app -w /app node:24-alpine node scripts/setup.mjs --env-only
docker compose --profile demo up --build     # → http://localhost:8080
```

데모 HIS가 필요 없으면 `--profile demo`를 빼십시오.

### 첫 내보내기 (두 방법 공통)

1. **http://localhost:8080** → **설정(Settings)** 에서 API 키(`.env` 파일의 `API_KEYS=` 줄의 값 —
   보안을 위해 설정 단계는 키를 화면에 출력하지 않습니다)를 붙여 넣고 **설정 저장**을 누릅니다.
   키는 브라우저 메모리에만 보관됩니다.
2. 언어 전환 메뉴에서 표시 언어(한국어 / English / 日本語 / Tiếng Việt)를 선택합니다.
3. **데이터 내보내기** → **FHIR Endpoint** → 서버 URL 입력
   - `pnpm demo`: `http://localhost:8090/fhir`
   - Docker 데모 프로필: `http://demo-his:8090/fhir`
4. 환자 ID `demo-kr-001`(또는 `demo-vn-001`, `demo-jp-001`, `demo-en-001`) → 내보내기 시작 →
   FHIR R4 번들(JSON 또는 NDJSON) 다운로드.
5. **데이터 가져오기** → 한국 컬럼 매핑 예시 선택 → **샘플 데이터로 체험** → **가져오기** → CSV / Excel에서
   만든 FHIR 번들 다운로드.

설치 상태는 언제든 `pnpm smoke`로 확인할 수 있습니다(상태 확인 → HIS 연결 → 내보내기 → 다운로드,
Docker 데모: `pnpm smoke --his http://demo-his:8090/fhir`).

### 실제 병원 HIS 연결

SSRF 방지를 위해 사설망·루프백 주소(10.x, 172.16.x, 192.168.x, localhost)는 기본적으로
**차단**됩니다. HIS는 대부분 병원 내부망에 있으므로 `.env`에 명시적으로 허용한 뒤
`pnpm start`(또는 `docker compose up`)로 실행하십시오.

```bash
# 호스트명, IPv4 주소, IPv4 CIDR 또는 host:port를 쉼표로 구분
CONNECTOR_ALLOWED_HOSTS=his.hospital.local,10.20.0.0/16
```

클라우드 메타데이터 주소(169.254.0.0/16, `metadata.google.internal` 등)는 목록에 넣어도
항상 차단됩니다. HIS가 CSV/Excel로 내보내는 경우 [컬럼 매핑 안내](examples/README.md)와
한국 병원용 예시 [csv-korea-hospital.json](examples/column-mappings/csv-korea-hospital.json)을
참고하십시오.

## CLI 사용

```bash
# FHIR 엔드포인트에서 내보내기(내부망/localhost 주소는 허용 목록 필요)
CONNECTOR_ALLOWED_HOSTS=localhost:8090 \
  pnpm fhirbridge export --patient-id demo-kr-001 --endpoint http://localhost:8090/fhir --output bundle.json

# CSV/Excel을 컬럼 매핑으로 FHIR 번들로 변환
pnpm fhirbridge import --file examples/data/kr-hospital.csv --mapping examples/column-mappings/csv-korea-hospital.json --output bundle.json

# FHIR 번들 검증
pnpm fhirbridge validate --input bundle.json

# 한국어 AI 요약(전송 전 비식별화, ANTHROPIC_API_KEY 또는 OPENAI_API_KEY 필요)
export ANTHROPIC_API_KEY=...
pnpm fhirbridge summarize --input bundle.json --provider claude --language ko
```

## 한국 개인정보보호법(PIPA) 관련 기능

- **주민등록번호 보호**: 입력 단계에서 감지된 주민등록번호는 HMAC 해시 또는 마스킹되며 원문이
  파이프라인을 통과하지 않습니다(제24조의2).
- **국외 이전 동의**: 동의 화면은 제28조의8의 다섯 가지 고지 항목을 모두 표시하며, 한국 시장
  동의 API는 다섯 항목을 모두 확인하지 않은 요청을 거부합니다.
- **접속기록**: `.env`에 `AUDIT_PROFILE=kr`을 설정하면 감사 로그에 `patientRefHash`(HMAC)와
  `sourceIp`가 기록됩니다. 2년 이상 보관하려면 `AUDIT_RETENTION_DAYS=730` 이상으로 설정하십시오
  (PostgreSQL 감사 로그 필요).
- **AI 요약은 선택 사항**입니다. API 키를 설정하지 않으면 비활성화되며 내보내기·가져오기는
  그대로 동작합니다. 국외 AI 제공자 사용 전 영문 README의
  [Data residency — Korea (PIPA)](README.md#data-residency--korea-pipa)를 확인하십시오.
  본 문서는 기술 안내이며 **법률 자문이 아닙니다**.
- **국내/병원 내부에서 AI 모델 운영**: `openai` 제공자는 OpenAI Chat Completions API와 호환되는
  모든 서버와 통신합니다. `.env`에 `AI_PROVIDER=openai`, `OPENAI_BASE_URL=http://10.20.0.5:8000/v1`
  (자체 서버 주소), `OPENAI_MODEL=<서버가 제공하는 모델 이름>`, `OPENAI_API_KEY=<서버가 요구하는 키,
키를 검사하지 않으면 임의의 값>`을 설정하십시오. 전송 전 비식별화는 그대로 적용됩니다
  ([자세히](README.md#ai-summaries-without-leaving-your-network)).

## 참여하기

한국어 번역 검토, 한국 HIS용 컬럼 매핑, 버그 제보를
[GitHub Issues](https://github.com/Digital-Healthcare-OpenSource/FHIRBridge/issues)로
보내 주십시오. [CONTRIBUTING.md](CONTRIBUTING.md)와 [행동 강령](CODE_OF_CONDUCT.md)을
참고하시고, 보안 취약점은 [SECURITY.md](.github/SECURITY.md)에 따라 비공개로 제보해 주십시오.

라이선스: [MIT](LICENSE)
