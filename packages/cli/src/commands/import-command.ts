/**
 * Import command — convert CSV/Excel files to FHIR bundle using connectors + transform pipeline.
 */

import type { Command } from 'commander';
import { readFileSync, existsSync } from 'fs';
import { extname } from 'path';
import {
  TransformPipeline,
  BundleBuilder,
  serializeToJson,
  serializeToNdjson,
  CsvConnector,
  ExcelConnector,
} from '@fhirbridge/core';
import type { MappingConfig, RawRecord, ConnectorRawRecord } from '@fhirbridge/core';
import { promptImportOptions } from '../prompts/import-prompts.js';
import { createProgress } from '../formatters/progress-display.js';
import { writeOutput } from '../utils/file-writer.js';
import { info, success, error, debug } from '../utils/logger.js';

export function registerImportCommand(program: Command): void {
  program
    .command('import')
    .description('Import patient data from CSV or Excel and produce a FHIR bundle')
    .option('--file <path>', 'Path to CSV or Excel file')
    .option('--mapping <path>', 'Path to column mapping JSON file')
    .option('--resource-type <type>', 'Target FHIR resource type', 'Patient')
    .option('--output <path>', 'Output file path (default: stdout)')
    .option('--format <json|ndjson>', 'Output format', 'json')
    .action(async (opts: ImportOptions) => {
      try {
        await runImport(opts);
      } catch (err) {
        error((err as Error).message);
        process.exit(1);
      }
    });
}

interface ImportOptions {
  file?: string;
  mapping?: string;
  resourceType?: string;
  output?: string;
  format?: string;
}

async function runImport(opts: ImportOptions): Promise<void> {
  const resolved = await promptImportOptions({
    filePath: opts.file,
    mappingPath: opts.mapping,
    // Pass empty string for outputPath (meaning stdout) to avoid requiring TTY when no --output flag
    outputPath: opts.output ?? '',
    format: opts.format as 'json' | 'ndjson' | undefined,
  });

  if (!existsSync(resolved.filePath)) {
    throw new Error(`Input file not found: ${resolved.filePath}`);
  }

  // Load mapping config
  let mappingConfig: MappingConfig | undefined;
  if (resolved.mappingPath) {
    if (!existsSync(resolved.mappingPath)) {
      throw new Error(`Mapping file not found: ${resolved.mappingPath}`);
    }
    const raw = readFileSync(resolved.mappingPath, 'utf8');
    mappingConfig = JSON.parse(raw) as MappingConfig;
    debug(`Loaded mapping: ${resolved.mappingPath}`);
  }

  const resourceType = opts.resourceType ?? 'Patient';
  info(`Reading file: ${resolved.filePath}`);

  // Phát hiện loại file theo extension để chọn đúng connector
  const ext = extname(resolved.filePath).toLowerCase();
  const isExcel = ext === '.xlsx' || ext === '.xls';

  // Parse CSV hoặc Excel bằng connector tương ứng từ @fhirbridge/core
  // ConnectorRawRecord (interface với known fields) ≠ pipeline.RawRecord (Record<string,unknown>)
  // Dùng ConnectorRawRecord[] để lưu kết quả connector, cast khi feed vào pipeline
  const connectorRecords: ConnectorRawRecord[] = [];
  try {
    // MappingConfig (Record<string,string>) → ColumnMapping[] cho connector
    // Mỗi key là sourceColumn, value là fhirPath
    const columnMapping = mappingConfig
      ? Object.entries(mappingConfig).map(([sourceColumn, fhirPath]) => ({
          sourceColumn,
          fhirPath,
          resourceType,
        }))
      : [];

    if (isExcel) {
      // Sử dụng ExcelConnector cho .xlsx/.xls
      const connector = new ExcelConnector();
      await connector.connect({
        type: 'excel',
        filePath: resolved.filePath,
        mapping: columnMapping,
      });
      for await (const record of connector.fetchPatientData('*')) {
        connectorRecords.push(record);
      }
      await connector.disconnect();
    } else {
      // Mặc định dùng CsvConnector cho .csv và các file text khác
      const connector = new CsvConnector();
      await connector.connect({
        type: 'csv',
        filePath: resolved.filePath,
        mapping: columnMapping,
      });
      for await (const record of connector.fetchPatientData('*')) {
        connectorRecords.push(record);
      }
      await connector.disconnect();
    }
  } catch (parseErr) {
    error(`Parse failed: ${(parseErr as Error).message}`);
    throw parseErr;
  }

  info(`Loaded ${connectorRecords.length} records`);

  const progress = createProgress(Math.max(connectorRecords.length + 2, 3), 'Transforming');

  // Run transform pipeline — collect into single bundle
  // PIPA: RRN (주민등록번호) trong cột identifier được hash bằng HMAC nếu secret
  // có mặt; không có secret thì mask — không bao giờ giữ raw RRN trong output.
  const pipeline = new TransformPipeline({
    resourceType,
    mappingConfig,
    skipOnError: true,
    rrnSecret: process.env['FHIRBRIDGE_HMAC_SECRET'],
  });
  const builder = new BundleBuilder();
  let processed = 0;

  // Cast ConnectorRawRecord → pipeline.RawRecord (Record<string,unknown>) — structurally compatible
  async function* recordIterator(): AsyncIterable<RawRecord> {
    for (const r of connectorRecords) yield r as unknown as RawRecord;
  }

  for await (const batchBundle of pipeline.pipe(recordIterator())) {
    for (const entry of batchBundle.entry ?? []) {
      if (entry.resource) {
        builder.addResource(entry.resource);
        processed++;
        progress.increment();
      }
    }
  }

  const bundle = builder.build();

  const output = resolved.format === 'ndjson' ? serializeToNdjson(bundle) : serializeToJson(bundle);

  progress.stop();

  writeOutput(output, resolved.outputPath || undefined);

  success(
    `Imported ${processed} resources from ${connectorRecords.length} records` +
      (resolved.outputPath ? ` → ${resolved.outputPath}` : ' → stdout'),
  );
}
