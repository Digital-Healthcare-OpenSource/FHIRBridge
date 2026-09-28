/**
 * Generates examples/data/jp-clinic.xlsx (synthetic data for
 * examples/column-mappings/excel-japan-clinic.json).
 * Run from the repo root: node examples/data/generate-jp-clinic-xlsx.cjs
 *
 * 生年月日 / 受診日時 are real Excel date cells (the importer reads their
 * numFmt), the rest are text. All names/IDs are fictitious placeholders.
 */

const path = require('path');

// exceljs is a dependency of @fhirbridge/core — resolve it from there.
const ExcelJS = require(
  require.resolve('exceljs', { paths: [path.resolve(__dirname, '../../packages/core')] }),
);

/** Wall-clock time as a UTC Date — how Excel date cells are stored. */
const cell = (y, mo, d, h = 0, mi = 0) => new Date(Date.UTC(y, mo - 1, d, h, mi));

async function generate() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'FHIRBridge examples';
  wb.created = cell(2024, 1, 1);
  wb.modified = cell(2024, 1, 1);

  const patients = wb.addWorksheet('患者');
  patients.columns = [
    { header: '患者番号', key: 'id', width: 10 },
    { header: '姓', key: 'family', width: 8 },
    { header: '名', key: 'given', width: 8 },
    { header: '性別', key: 'gender', width: 6 },
    { header: '生年月日', key: 'birth', width: 12, style: { numFmt: 'yyyy-mm-dd' } },
    { header: '住所', key: 'address', width: 28 },
  ];
  patients.addRows([
    {
      id: 'P0001',
      family: '山田',
      given: '太郎',
      gender: '男',
      birth: cell(1980, 4, 1),
      address: '東京都千代田区テスト1-1',
    },
    {
      id: 'P0002',
      family: '鈴木',
      given: '花子',
      gender: '女',
      birth: cell(1992, 8, 15),
      address: '大阪府大阪市サンプル2-2',
    },
    {
      id: 'P0003',
      family: '田中',
      given: '一郎',
      gender: '不明',
      birth: cell(1975, 12, 31),
      address: '北海道札幌市ダミー3-3',
    },
  ]);

  const visits = wb.addWorksheet('受診');
  visits.columns = [
    { header: '患者番号', key: 'id', width: 10 },
    { header: '受診日時', key: 'at', width: 18, style: { numFmt: 'yyyy-mm-dd hh:mm' } },
    { header: '受診区分', key: 'kind', width: 8 },
    { header: '診断コード', key: 'code', width: 10 },
    { header: '診断名', key: 'name', width: 16 },
  ];
  visits.addRows([
    { id: 'P0001', at: cell(2024, 3, 4, 9, 30), kind: '外来', code: 'I10', name: '本態性高血圧症' },
    { id: 'P0001', at: cell(2024, 4, 1, 10, 0), kind: '外来', code: 'I10', name: '本態性高血圧症' },
    { id: 'P0002', at: cell(2024, 3, 11, 14, 0), kind: '入院', code: 'E11.9', name: '2型糖尿病' },
    { id: 'P0003', at: cell(2024, 3, 21, 8, 45), kind: '外来', code: 'J45.9', name: '喘息' },
  ]);

  const outPath = path.join(__dirname, 'jp-clinic.xlsx');
  await wb.xlsx.writeFile(outPath);
  console.log('Generated:', outPath);
}

generate().catch((err) => {
  console.error('Failed to generate jp-clinic.xlsx:', err);
  process.exit(1);
});
