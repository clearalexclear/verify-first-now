import { runInvestigationJobById } from "@/lib/investigation/worker.server";
const jobId = process.argv[2];
runInvestigationJobById(jobId, `manual-${Date.now()}`, { deliver: false, allowRerun: true })
  .then((r) => { console.log(JSON.stringify(r, null, 2)); })
  .catch((e) => { console.error(e); process.exit(1); });
