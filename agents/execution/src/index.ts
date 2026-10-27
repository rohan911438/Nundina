import { env, every, executionService } from "@nundina/agents-core";

const svc = executionService();
await every("execution", env().EXECUTION_INTERVAL_S, async () => {
  const r = await svc.tick();
  console.log(`execution: ${r.agents} agent(s), ${r.signals} live signal(s)`);
});
