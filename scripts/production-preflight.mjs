import { productionIssues } from './lib/production-check.mjs';
// Read only the supplied environment; never load development .env or print values.
const failures = productionIssues(process.env);
if (failures.length) {
  console.error('Production configuration checks failed: ' + failures.join(', '));
  process.exitCode = 1;
} else {
  console.log(
    'Production configuration checks passed. This does not verify deployment, backups, alerts or live providers.',
  );
}
