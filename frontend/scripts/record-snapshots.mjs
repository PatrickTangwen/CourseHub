/**
 * Record the developer-panel endpoint responses from a running CourseHub
 * backend into a demo fixture (verbatim, no editing).
 *
 * Usage: node scripts/record-snapshots.mjs [--url http://localhost:8010]
 *        [--out src/demo/fixtures/panel-snapshots.json]
 */
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const args = { url: "http://localhost:8010", out: "src/demo/fixtures/panel-snapshots.json" };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--url") args.url = argv[++i];
  else if (argv[i] === "--out") args.out = argv[++i];
}

async function getJson(path) {
  const response = await fetch(`${args.url}${path}`);
  if (!response.ok) throw new Error(`GET ${path} failed: ${response.status}`);
  return response.json();
}

const fixture = {
  recorded_at: new Date().toISOString(),
  backend: args.url,
  knowledge_stats: await getJson("/knowledge/stats"),
  monitor: await getJson("/monitor"),
  skills: await getJson("/skills?include_content=true"),
};

const outPath = resolve(args.out);
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify(fixture, null, 2) + "\n", "utf8");
console.log(
  `Wrote ${outPath} (${fixture.skills.count} skills, ` +
    `${fixture.knowledge_stats.total_chunks} chunks, ` +
    `${Object.keys(fixture.monitor.agent_stats ?? {}).length} agent stats)`,
);
