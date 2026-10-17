// Runs a Code-node source file outside n8n with a fake $input, $('Node'), $env and static data.
// Good enough for unit tests of the logic; the real n8n runtime is still the final check.
import fs from 'node:fs';
import crypto from 'node:crypto';

const AsyncFunction = (async () => {}).constructor;
const toItems = (list = []) => list.map((x) => (x && typeof x === 'object' && 'json' in x ? x : { json: x }));
const accessor = (items) => ({ all: () => items, first: () => items[0], last: () => items.at(-1) });

/**
 * @param {string} file  path to the Code node source
 * @param {object} ctx
 *   items       input items (plain objects or {json, binary})
 *   nodes       { 'Node name': [items] } for $('Node name')
 *   mode        'all' (Run Once for All Items) | 'each' (Run Once for Each Item)
 *   staticData  object returned by $getWorkflowStaticData('global'); mutated in place
 *   env         $env
 *   prevNode    $prevNode.name
 * @returns {Promise<object[]>} the json of every output item
 */
export async function runCode(file, ctx = {}) {
  const { mode = 'all', staticData = {}, env = {}, prevNode = '' } = ctx;
  const input = toItems(ctx.items);
  const nodes = Object.fromEntries(Object.entries(ctx.nodes || {}).map(([k, v]) => [k, toItems(v)]));
  const source = fs.readFileSync(file, 'utf8');
  const fn = new AsyncFunction('$input', '$', '$json', '$getWorkflowStaticData', '$env', 'require', '$prevNode', source);
  const req = (m) => { if (m === 'crypto') return crypto; throw new Error(`Module '${m}' is not allowed`); };
  const helpers = {
    getBinaryDataBuffer: async (i, prop) => {
      const bin = input[i]?.binary?.[prop];
      if (!bin) throw new Error(`No binary data '${prop}'`);
      return Buffer.from(bin.data, 'base64');
    },
  };
  const node$ = (index) => (name) => {
    if (!nodes[name]) throw new Error(`Referenced node is unexecuted: ${name}`);
    return { ...accessor(nodes[name]), item: nodes[name][index] ?? nodes[name][0] };
  };
  const call = (inputApi, $, $json) =>
    fn.call({ helpers }, inputApi, $, $json, () => staticData, env, req, { name: prevNode });

  const unwrap = (out) => (out == null ? [] : (Array.isArray(out) ? out : [out])).map((x) => (x && 'json' in x ? x.json : x));

  if (mode === 'all') return unwrap(await call(accessor(input), node$(0), input[0]?.json));

  const results = [];
  for (const [i, item] of input.entries()) {
    results.push(...unwrap(await call({ ...accessor(input), item }, node$(i), item.json)));
  }
  return results;
}
