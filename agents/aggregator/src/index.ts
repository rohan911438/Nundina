import { runAggregator } from "@nundina/agents-core";

await runAggregator(Number(process.env.AGGREGATOR_INTERVAL_S ?? 7200));
