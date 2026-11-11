import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  DEFAULT_EVAL_DATASET,
  DEFAULT_EVAL_THRESHOLDS,
  buildReport,
  createAIProvider,
  formatReport,
  parseAIProviderConfig,
  runEvaluation,
} from '../packages/ai-core/dist/index.js';

async function main(): Promise<void> {
  const provider = createAIProvider(parseAIProviderConfig(process.env));
  const results = await runEvaluation({ provider, dataset: DEFAULT_EVAL_DATASET });
  const report = buildReport({
    results,
    dataset: DEFAULT_EVAL_DATASET,
    provider: provider.metadata,
    thresholds: DEFAULT_EVAL_THRESHOLDS,
  });

  const outputDir = join(process.cwd(), 'var', 'eval');
  await mkdir(outputDir, { recursive: true });
  const stamp = report.generatedAt.replace(/[:.]/g, '-');
  const body = `${JSON.stringify(report, null, 2)}\n`;
  await writeFile(join(outputDir, `${stamp}.json`), body, 'utf8');
  await writeFile(join(outputDir, 'latest.json'), body, 'utf8');

  console.log(formatReport(report));
  console.log(`report var/eval/${stamp}.json`);
  if (!report.passed) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'AI evaluation failed.');
  process.exitCode = 1;
});
