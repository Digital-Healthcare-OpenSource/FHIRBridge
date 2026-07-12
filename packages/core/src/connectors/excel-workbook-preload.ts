/**
 * Workaround for an ExcelJS streaming WorkbookReader ordering bug.
 *
 * WorkbookReader giả định `xl/workbook.xml` + `xl/sharedStrings.xml` xuất hiện
 * TRƯỚC các worksheet trong zip (thứ tự Excel desktop ghi). File sinh bởi thư
 * viện (chính ExcelJS writer, openpyxl, ...) lại đặt `xl/workbook.xml` ở CUỐI
 * zip → reader crash (`this.model.sheets` undefined) hoặc drop entry vì race
 * trong vòng lặp temp-file của nó.
 *
 * Fix: đọc 3 entry metadata qua central directory (random access — không giải
 * nén worksheet nào), parse bằng CHÍNH parser nội bộ của reader, rồi pre-set
 * lên instance. Worksheet khi đó luôn đi đường immediate-parse (đường
 * battle-tested của exceljs), bất kể thứ tự entry.
 *
 * NOTE: dựa vào internal API của exceljs (pinned 4.x). Test connector sẽ vỡ
 * to nếu upgrade đổi các method này.
 */

import unzip from 'unzipper';

/** Trần kích thước giải nén cho entry metadata (workbook.xml / rels) — file thật chỉ vài KB. */
const MAX_METADATA_BYTES = 4 * 1024 * 1024; // 4 MB

/**
 * Structural view over WorkbookReader internals used for preloading.
 * `_parse*` là internal API của exceljs stream reader.
 */
export interface PreloadableWorkbookReader {
  _parseRels(entry: NodeJS.ReadableStream): Promise<void>;
  _parseWorkbook(entry: NodeJS.ReadableStream): Promise<void>;
  _parseSharedStrings(entry: NodeJS.ReadableStream): AsyncGenerator<unknown>;
  workbookRels?: unknown;
  model?: unknown;
  sharedStrings?: unknown[];
}

/**
 * Pre-parse workbook metadata (sheet names, rels, shared strings) from the
 * zip central directory and set it on the reader instance BEFORE streaming.
 *
 * Sau khi gọi hàm này, reader parse worksheet ngay khi gặp entry (immediate
 * path) — không còn phụ thuộc `xl/workbook.xml` đứng trước worksheet.
 */
export async function preloadWorkbookMetadata(
  reader: PreloadableWorkbookReader,
  filePath: string,
): Promise<void> {
  const directory = await unzip.Open.file(filePath);
  const findEntry = (entryPath: string) =>
    directory.files.find((f) => f.path === entryPath && f.type === 'File');

  const relsEntry = findEntry('xl/_rels/workbook.xml.rels');
  const workbookEntry = findEntry('xl/workbook.xml');
  const sharedStringsEntry = findEntry('xl/sharedStrings.xml');

  for (const entry of [relsEntry, workbookEntry]) {
    if (entry && entry.uncompressedSize > MAX_METADATA_BYTES) {
      throw new Error(
        `Workbook metadata entry exceeds ${MAX_METADATA_BYTES} byte limit: ${entry.path}`,
      );
    }
  }

  if (relsEntry) {
    await reader._parseRels(relsEntry.stream());
  }
  if (workbookEntry) {
    await reader._parseWorkbook(workbookEntry.stream());
  }

  if (sharedStringsEntry) {
    // 'cache' mode: generator không yield gì, chỉ fill reader.sharedStrings —
    // vẫn phải drain để chạy hết parser.
    for await (const _event of reader._parseSharedStrings(sharedStringsEntry.stream())) {
      void _event;
    }
  } else {
    // Không có shared strings (file toàn số/inline string) — set mảng rỗng để
    // worksheet vẫn thỏa điều kiện immediate-parse của reader.
    reader.sharedStrings = [];
  }
}
