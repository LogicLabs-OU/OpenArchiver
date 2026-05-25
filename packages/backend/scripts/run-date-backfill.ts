/**
 * CLI: enqueue a date-backfill planner job. Usage:
 *   pnpm --filter @open-archiver/backend backfill:dates [-- --ingestion-source <uuid>] [--batch-size 200]
 *
 * Run from a built tree (`node dist/scripts/run-date-backfill.js ...`) or via
 * ts-node-dev in dev. Keeps argument parsing bare on purpose — no yargs.
 */
import { DateBackfillService } from '../src/services/DateBackfillService';
import { dateBackfillQueue } from '../src/jobs/queues';

function readFlag(name: string): string | undefined {
	const argv = process.argv.slice(2);
	const i = argv.indexOf(`--${name}`);
	if (i >= 0 && i + 1 < argv.length) return argv[i + 1];
	const eq = argv.find((a) => a.startsWith(`--${name}=`));
	return eq ? eq.slice(name.length + 3) : undefined;
}

async function main(): Promise<void> {
	const ingestionSourceId = readFlag('ingestion-source');
	const batchSizeRaw = readFlag('batch-size');
	const batchSize = batchSizeRaw ? Number.parseInt(batchSizeRaw, 10) : undefined;
	if (batchSize !== undefined && (!Number.isInteger(batchSize) || batchSize < 1)) {
		throw new Error(`Invalid --batch-size value: ${batchSizeRaw}`);
	}

	const { jobId } = await DateBackfillService.start({ ingestionSourceId, batchSize });
	// eslint-disable-next-line no-console
	console.log(JSON.stringify({ jobId, ingestionSourceId, batchSize }, null, 2));

	// Close the queue's redis connection so the process can exit cleanly.
	await dateBackfillQueue.close();
}

main().catch((err) => {
	// eslint-disable-next-line no-console
	console.error(err instanceof Error ? err.stack : String(err));
	process.exit(1);
});
