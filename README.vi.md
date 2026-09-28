<p align="center">
  <h1 align="center">FHIRBridge</h1>
  <p align="center">
    <strong>Công cụ mã nguồn mở giúp bệnh viện, phòng khám chuyển dữ liệu bệnh nhân sang chuẩn FHIR R4</strong><br/>
    Tự vận hành. Lấy dữ liệu từ HIS. Xuất FHIR R4. Tóm tắt bằng AI (tuỳ chọn). Không lưu dữ liệu bệnh nhân.
  </p>
  <p align="center">
    <a href="README.md">English</a> &bull;
    <b>Tiếng Việt</b> &bull;
    <a href="README.ko.md">한국어</a> &bull;
    <a href="README.ja.md">日本語</a>
  </p>
</p>

---

> Đây là bản hướng dẫn nhanh bằng tiếng Việt. Tài liệu đầy đủ (API, bảo mật, triển khai,
> biến môi trường) nằm ở [README.md](README.md) (tiếng Anh).

## FHIRBridge là gì?

Hồ sơ bệnh án của người bệnh đang bị "khoá" trong hệ thống thông tin bệnh viện (HIS) của từng
nơi. **FHIRBridge** là cây cầu: kết nối tới HIS qua FHIR API hoặc file CSV/Excel, chuyển dữ
liệu thành gói (Bundle) chuẩn **FHIR R4**, và (nếu muốn) tạo bản tóm tắt bằng AI sau khi đã
ẩn danh hoá — tất cả chạy trên máy chủ của chính bạn.

**Không có SaaS, không thu phí, không giới hạn.** Bạn tải mã nguồn về và tự chạy. Bệnh viện /
phòng khám là đơn vị vận hành và là bên kiểm soát dữ liệu.

## Chạy thử nhanh

Chọn một trong hai cách. Cả hai đều mở giao diện web tại **http://localhost:8080**, kèm một
**HIS demo** chứa bệnh nhân giả lập (Việt Nam, Hàn Quốc, Nhật Bản, Mỹ) để bạn thử xuất dữ
liệu ngay mà không cần HIS thật hay kết nối Internet.

### Cách A — Dùng Node.js (Windows / macOS / Linux)

Cần Node.js ≥ 22 (khuyên dùng bản LTS 24) và pnpm ≥ 9 (chạy `corepack enable` để có pnpm).

```bash
git clone https://github.com/Digital-Healthcare-OpenSource/FHIRBridge.git
cd FHIRBridge
pnpm install
pnpm run setup     # tạo file .env (khoá bí mật ngẫu nhiên + API key) và build toàn bộ
pnpm demo          # chạy API + giao diện web + HIS demo → http://localhost:8080
```

> Lưu ý: gõ `pnpm run setup`, **không** gõ `pnpm setup` (đó là lệnh có sẵn của pnpm).

### Cách B — Dùng Docker (máy không cần cài Node.js)

```bash
git clone https://github.com/Digital-Healthcare-OpenSource/FHIRBridge.git
cd FHIRBridge
# Tạo file .env (khoá bí mật + API key) bằng một container Node dùng một lần
docker run --rm -v "$PWD":/app -w /app node:24-alpine node scripts/setup.mjs --env-only
docker compose --profile demo up --build     # → http://localhost:8080
```

Bỏ `--profile demo` nếu không cần HIS demo.

### Xuất dữ liệu lần đầu (cả hai cách)

1. Mở **http://localhost:8080** → vào **Cài đặt (Settings)**, dán API key — là giá trị ở dòng
   `API_KEYS=` trong file `.env` (bước cài đặt không in key ra màn hình để tránh lộ) — rồi bấm
   **Lưu cài đặt**. Key chỉ nằm trong bộ nhớ trình duyệt, đóng tab là mất.
2. Chọn ngôn ngữ giao diện (Tiếng Việt / English / 日本語 / 한국어) ở nút chuyển ngôn ngữ.
3. Vào **Xuất dữ liệu** → chọn **FHIR Endpoint** → nhập địa chỉ máy chủ:
   - Nếu chạy `pnpm demo`: `http://localhost:8090/fhir`
   - Nếu chạy Docker với `--profile demo`: `http://demo-his:8090/fhir`
4. Mã bệnh nhân: `demo-vn-001` (hoặc `demo-kr-001`, `demo-jp-001`, `demo-en-001`) → bắt đầu
   xuất → tải về gói FHIR R4 (JSON hoặc NDJSON).
5. Vào **Nhập dữ liệu** → chọn mẫu ánh xạ cột của Việt Nam → **Dùng thử dữ liệu mẫu** → **Nhập dữ liệu**
   → tải về gói FHIR được tạo từ file CSV / Excel.

Muốn kiểm tra nhanh bản cài đặt bằng dòng lệnh: chạy `pnpm smoke` (kiểm tra sức khoẻ → kết nối HIS →
xuất → tải về; nếu dùng Docker demo: `pnpm smoke --his http://demo-his:8090/fhir`).

### Kết nối HIS thật của bệnh viện

Để chống tấn công SSRF, FHIRBridge mặc định **chặn** mọi địa chỉ mạng nội bộ (10.x, 172.16.x,
192.168.x, localhost). HIS của bệnh viện thường nằm đúng trong mạng nội bộ, nên bạn phải khai
báo rõ trong file `.env`, rồi chạy `pnpm start` (hoặc `docker compose up`):

```bash
# tên máy, địa chỉ IPv4, dải CIDR hoặc cặp host:port, cách nhau bởi dấu phẩy
CONNECTOR_ALLOWED_HOSTS=his.benhvien.local,10.20.0.0/16
```

Các địa chỉ metadata của cloud (169.254.0.0/16, `metadata.google.internal`, …) luôn bị chặn,
kể cả khi được khai báo. Nếu HIS xuất dữ liệu dạng CSV/Excel, xem
[hướng dẫn column mapping](examples/README.md) — có sẵn mẫu cho file CSV kiểu VneID của bệnh
viện Việt Nam: [csv-vneid-vn.json](examples/column-mappings/csv-vneid-vn.json).

## Dùng dòng lệnh (CLI)

```bash
# Xuất dữ liệu từ FHIR endpoint (địa chỉ nội bộ / localhost phải được cho phép)
CONNECTOR_ALLOWED_HOSTS=localhost:8090 \
  pnpm fhirbridge export --patient-id demo-vn-001 --endpoint http://localhost:8090/fhir --output bundle.json

# Chuyển file CSV/Excel thành gói FHIR theo column mapping
pnpm fhirbridge import --file examples/data/vn-hospital.csv --mapping examples/column-mappings/csv-vneid-vn.json --output bundle.json

# Kiểm tra gói FHIR có hợp lệ không
pnpm fhirbridge validate --input bundle.json

# Tóm tắt bằng AI tiếng Việt (dữ liệu được ẩn danh trước khi gửi; cần ANTHROPIC_API_KEY hoặc OPENAI_API_KEY)
export ANTHROPIC_API_KEY=...
pnpm fhirbridge summarize --input bundle.json --provider claude --language vi
```

## Tóm tắt AI và quy định bảo vệ dữ liệu tại Việt Nam

Tính năng tóm tắt AI là **tuỳ chọn** — không đặt `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` thì
tính năng này tắt, còn xuất dữ liệu và nhập CSV/Excel vẫn hoạt động bình thường.

Theo Nghị định 13/2023/NĐ-CP, thông tin sức khoẻ, bệnh án là **dữ liệu cá nhân nhạy cảm**.
Gửi dữ liệu (kể cả đã ẩn danh hoá) tới nhà cung cấp AI đặt ở nước ngoài được xem là **chuyển
dữ liệu ra nước ngoài** và cần hồ sơ đánh giá tác động theo quy định. Khuyến nghị cho bệnh
viện tại Việt Nam: để tắt tóm tắt AI, hoặc dùng nhà cung cấp đặt trong nước / tự vận hành. Xem
chi tiết tại mục [Data residency — Vietnam (PDPD)](README.md#data-residency--vietnam-pdpd) của
README tiếng Anh. Đây là hướng dẫn kỹ thuật, **không phải tư vấn pháp lý**.

## Góp ý và đóng góp

Rất hoan nghênh góp ý về bản dịch tiếng Việt, mẫu column mapping cho HIS tại Việt Nam, và báo
lỗi qua [GitHub Issues](https://github.com/Digital-Healthcare-OpenSource/FHIRBridge/issues).
Xem [CONTRIBUTING.md](CONTRIBUTING.md) và [Quy tắc ứng xử](CODE_OF_CONDUCT.md). Lỗ hổng bảo mật
vui lòng báo riêng theo [SECURITY.md](.github/SECURITY.md).

Giấy phép: [MIT](LICENSE).
