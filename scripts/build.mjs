// Builds every projects/*/workflow.json from projects/*/workflow.mjs and the Code-node sources in projects/*/src.
// Usage: node scripts/build.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectsDir = path.join(root, 'projects');

for (const dir of fs.readdirSync(projectsDir).sort()) {
  const def = path.join(projectsDir, dir, 'workflow.mjs');
  if (!fs.existsSync(def)) continue;
  const { default: outputs } = await import(pathToFileURL(def));
  for (const { file, workflow } of outputs) {
    const names = new Set(workflow.nodes.map((n) => n.name));
    const ids = new Set(workflow.nodes.map((n) => n.id));
    if (names.size !== workflow.nodes.length || ids.size !== workflow.nodes.length) throw new Error(`${dir}: duplicate node name or id`);
    for (const [from, { main }] of Object.entries(workflow.connections)) {
      for (const to of main.flat()) {
        if (!names.has(from) || !names.has(to.node)) throw new Error(`${dir}: connection ${from} → ${to.node} points to a missing node`);
      }
    }
    fs.writeFileSync(path.join(projectsDir, dir, file), JSON.stringify(workflow, null, 2) + '\n');
    const stickies = workflow.nodes.filter((n) => n.type === 'n8n-nodes-base.stickyNote').length;
    console.log(`built projects/${dir}/${file} (${workflow.nodes.length - stickies} nodes, ${stickies} notes)`);
  }
}
