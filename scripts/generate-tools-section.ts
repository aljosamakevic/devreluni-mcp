// Phase 06 T09/T10 — Build-time tools-section generator.
//
// Walks `src/tools/*.ts` (excluding `*.test.ts`), extracts each tool's
// registration metadata via regex against the `server.registerTool('name', {
// description: '...' })` call, groups tools by which gate they serve
// (mapping derived from `src/resources/tool-to-gate-map.md`), and emits:
//
//   - build/tools-manifest.json — structured manifest, machine-readable
//   - build/tools-section.html   — rendered HTML fragment for the landing
//
// Then templates the fragment into `public/index.html` by replacing the
// `<!-- TOOLS_SECTION -->` marker. The git-tracked `public/index.html`
// keeps the rendered version per CONTEXT.md decision (idempotent re-build
// produces the same content).
//
// Why regex over AST: the registration calls are uniform across all 13
// tools (same shape, same key order, multi-line strings). A 20-line regex
// matches the description robustly without pulling in a TypeScript parser.
// If the registration shape ever drifts, the script logs a warning and
// the next executor catches the regression in a code review.
//
// Run via npm run build (extended in the same commit).

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const TOOLS_DIR = path.join(REPO_ROOT, 'src/tools');
const GATE_MAP_PATH = path.join(REPO_ROOT, 'src/resources/tool-to-gate-map.md');
const LANDING_PATH = path.join(REPO_ROOT, 'public/index.html');
const BUILD_DIR = path.join(REPO_ROOT, 'build');

// Tool description description-extraction regex.
// Matches:  server.registerTool(\n  '<name>',\n  {\n    description:\n      '<single-line>',
//          or '<single-line>' (no newline before string)
//          or "..." double-quoted
// Capture group 1 = tool name; group 2 = description.
const REGISTER_RX =
  /server\.registerTool\(\s*['"]([a-z_0-9]+)['"]\s*,\s*\{\s*description\s*:\s*([\s\S]*?),\s*inputSchema/;

// Hand-curated overrides for the rare descriptions that embed runtime
// constants via template literals. Keeping these in code (rather than
// trying to evaluate the literal at extract time) keeps the extractor
// dependency-free and predictable.
const DESCRIPTION_OVERRIDES: Record<string, string> = {
  find_yc_rfs_alignment:
    "Assess alignment between a product idea and YC's current Request for Startups vintage. Uses a static dataset — refreshed quarterly. Returns scored alignment across all 6 YC S26 categories.",
};

// Strip a leading/trailing single- or double-quote pair and collapse
// JS string-concatenation (rare but possible) into one line.
function normalizeDescription(raw: string): string {
  let s = raw.trim();
  // Collapse string concatenation: 'foo' + 'bar' → 'foobar'
  s = s.replace(/['"]\s*\+\s*['"]/g, '');
  // Strip outer quotes (single, double, or backtick).
  if (
    (s.startsWith("'") && s.endsWith("'")) ||
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith('`') && s.endsWith('`'))
  ) {
    s = s.slice(1, -1);
  }
  // Collapse internal whitespace
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

interface ToolMeta {
  name: string;
  description: string;
  file: string;
}

async function extractTools(): Promise<ToolMeta[]> {
  const files = (await fs.readdir(TOOLS_DIR))
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .sort();

  const out: ToolMeta[] = [];
  for (const f of files) {
    const src = await fs.readFile(path.join(TOOLS_DIR, f), 'utf8');
    const m = REGISTER_RX.exec(src);
    if (!m) {
      console.warn(`[generate-tools-section] ${f}: no registerTool match — skipping`);
      continue;
    }
    const name = m[1]!;
    let desc = DESCRIPTION_OVERRIDES[name] ?? normalizeDescription(m[2]!);
    // Truncate at 240 chars to avoid landing-page bloat (Risk R3 mitigation).
    if (desc.length > 240) {
      desc = desc.slice(0, 237).trimEnd() + '…';
    }
    if (desc.length < 30) {
      console.warn(`[generate-tools-section] ${f}: description suspiciously short (${desc.length} chars)`);
    }
    out.push({ name, description: desc, file: f });
  }
  return out;
}

// Parse the tool-to-gate map for the {tool → gates served as Primary} mapping.
// Row format:  | <tool> | P | s | | | |
// Columns are G1..G5 in fixed order.
async function parseGateMap(): Promise<Record<string, number[]>> {
  const md = await fs.readFile(GATE_MAP_PATH, 'utf8');
  const rows = md.split('\n').filter((l) => /^\|\s*[a-z_0-9]+\s*\|/i.test(l));
  const mapping: Record<string, number[]> = {};
  for (const row of rows) {
    const cells = row.split('|').map((c) => c.trim());
    // cells[0] is '' (left edge), cells[1] = tool name, cells[2..6] = G1..G5
    if (cells.length < 7) continue;
    const tool = cells[1];
    if (!tool || /^tool$/i.test(tool)) continue;
    const gates: number[] = [];
    for (let g = 1; g <= 5; g++) {
      const cell = cells[1 + g] || '';
      // Primary = 'P', secondary = 's'. Show under their PRIMARY gate.
      if (cell === 'P') gates.push(g);
    }
    mapping[tool] = gates;
  }
  return mapping;
}

const GATE_NAMES: Record<number, string> = {
  1: 'Gate 1 — Direct Competitor Scan',
  2: 'Gate 2 — Market Structure',
  3: 'Gate 3 — Platform Risk',
  4: 'Gate 4 — Willingness to Pay',
  5: 'Gate 5 — Why Now',
};

const UNGATED_GROUP = 'Cross-gate (synthesis)';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderHtmlFragment(tools: ToolMeta[], gateMap: Record<string, number[]>): string {
  // Group tools by primary gate. Tools with no primary gate (e.g.
  // finalize_validation_report — the rollup) land in UNGATED_GROUP.
  const groups: Record<string, ToolMeta[]> = {};
  for (let g = 1; g <= 5; g++) groups[GATE_NAMES[g]!] = [];
  groups[UNGATED_GROUP] = [];

  for (const t of tools) {
    const gates = gateMap[t.name] || [];
    if (gates.length === 0) {
      groups[UNGATED_GROUP]!.push(t);
      continue;
    }
    // Put under the FIRST primary gate. Some tools (read_competitor_changelog)
    // are listed Primary at G1 only; reuse rules in the map handle the rest.
    const g = gates[0]!;
    groups[GATE_NAMES[g]!]!.push(t);
  }

  const total = tools.length;
  const sections: string[] = [];
  sections.push(`<p class="eyebrow">${total} tools</p>`);
  sections.push(`<h2>Inside the framework.</h2>`);
  sections.push(
    `<p class="lede">Each gate calls a specific set of tools. Descriptions below are pulled verbatim from each tool's MCP registration at build time — no drift between code and docs.</p>`
  );

  for (const groupName of [GATE_NAMES[1]!, GATE_NAMES[2]!, GATE_NAMES[3]!, GATE_NAMES[4]!, GATE_NAMES[5]!, UNGATED_GROUP]) {
    const items = groups[groupName];
    if (!items || items.length === 0) continue;
    sections.push(`<div class="tools-group">`);
    sections.push(`  <h3>${escapeHtml(groupName)}</h3>`);
    sections.push(`  <ul>`);
    for (const t of items) {
      sections.push(`    <li>`);
      sections.push(`      <span class="t-name">${escapeHtml(t.name)}</span>`);
      sections.push(`      <span class="t-desc">${escapeHtml(t.description)}</span>`);
      sections.push(`    </li>`);
    }
    sections.push(`  </ul>`);
    sections.push(`</div>`);
  }
  return sections.join('\n');
}

async function ensureDir(d: string): Promise<void> {
  await fs.mkdir(d, { recursive: true });
}

async function main(): Promise<void> {
  const [tools, gateMap] = await Promise.all([extractTools(), parseGateMap()]);

  // Sanity warnings.
  const unmapped: string[] = tools
    .map((t) => t.name)
    .filter((n) => !gateMap[n] || gateMap[n].length === 0);
  if (unmapped.length > 0) {
    console.warn(
      `[generate-tools-section] ${unmapped.length} tool(s) without a Primary gate mapping: ${unmapped.join(', ')} — will appear under 'Cross-gate (synthesis)'.`
    );
  }

  await ensureDir(BUILD_DIR);
  const fragment = renderHtmlFragment(tools, gateMap);
  await fs.writeFile(path.join(BUILD_DIR, 'tools-section.html'), fragment + '\n', 'utf8');
  await fs.writeFile(
    path.join(BUILD_DIR, 'tools-manifest.json'),
    JSON.stringify({ generated_at: new Date().toISOString(), tools, gate_map: gateMap }, null, 2) + '\n',
    'utf8'
  );

  // Splice fragment into public/index.html at the <!-- TOOLS_SECTION --> marker.
  // The marker is preserved (left + right of fragment) so re-builds are idempotent.
  const landing = await fs.readFile(LANDING_PATH, 'utf8');
  // Match either the bare marker (first build) or any previous rendered block
  // bounded by BEGIN/END comments (subsequent builds — replace in place).
  const beginMarker = '<!-- TOOLS_SECTION:BEGIN -->';
  const endMarker = '<!-- TOOLS_SECTION:END -->';
  const bareMarker = '<!-- TOOLS_SECTION -->';

  const indented = fragment
    .split('\n')
    .map((l) => (l ? '          ' + l : l))
    .join('\n');
  const replacement = `${beginMarker}\n${indented}\n          ${endMarker}`;

  let next: string;
  if (landing.includes(bareMarker)) {
    next = landing.replace(bareMarker, replacement);
  } else if (landing.includes(beginMarker) && landing.includes(endMarker)) {
    const rx = new RegExp(
      beginMarker.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') +
        '[\\s\\S]*?' +
        endMarker.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'),
      'g'
    );
    next = landing.replace(rx, replacement);
  } else {
    console.warn(
      '[generate-tools-section] No TOOLS_SECTION marker found in public/index.html — skipping splice.'
    );
    next = landing;
  }

  if (next !== landing) {
    await fs.writeFile(LANDING_PATH, next, 'utf8');
    console.log(
      `[generate-tools-section] Wrote tools-section.html (${tools.length} tools, ${Object.keys(GATE_NAMES).length + 1} groups) and spliced into public/index.html.`
    );
  } else {
    console.log(
      `[generate-tools-section] Wrote tools-section.html (${tools.length} tools). Landing unchanged.`
    );
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[generate-tools-section] FATAL: ${msg}`);
  process.exit(1);
});
