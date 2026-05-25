#!/usr/bin/env tsx
/**
 * T20 — Mechanical assertion script for the Fomi calibration run.
 *
 * Reads the rendered markdown artifact captured by T19
 * (`.planning/validation-runs/01-fomi-focus-app.md`) and the structured
 * tool-response JSON (`.../01-fomi-focus-app-tool-response.json`) and
 * verifies six mechanical properties that together encode the spec §10
 * Phase 4 Critical Test ("if GO, there's a bug") + §11 DoD ("killshots
 * cite specific DOK 1 facts, not DOK 3 vibes") + the H6/M5 boundary
 * documented in CONCERNS.md.
 *
 * Exits 0 if all 6 assertions PASS, 1 otherwise.
 *
 * Note on data source: the captured tool-response JSON shape only contains
 * `{ status, markdown, issues, adjustments_made }` — it does NOT expose a
 * structured `adjusted_report.verdict.killshots[]` or
 * `gates[].dok1_facts[]`. So all parsing is done off the rendered markdown,
 * which IS the source of truth that downstream consumers will see.
 *
 * Invocation: `npx tsx scripts/assert-fomi-run.ts`
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

const ARTIFACT_PATH = resolve(
  REPO_ROOT,
  '.planning/validation-runs/01-fomi-focus-app.md',
);
const TOOL_RESPONSE_PATH = resolve(
  REPO_ROOT,
  '.planning/validation-runs/01-fomi-focus-app-tool-response.json',
);

// ---------------------------------------------------------------------------
// Canonical constant (must match src/validation/constants.ts byte-for-byte
// for assertion 6 to be a real defense-in-depth check). Copied here rather
// than imported so the script remains runnable even if module-resolution of
// the src/ tree changes.
// ---------------------------------------------------------------------------

const SPIKY_POV_BLANK_TEMPLATE_LINES = [
  '> ⚠️ The verdict above is a model-generated recommendation. The decision is yours.',
  'My take: [user fills in]',
  'What I disagree with in the report: [user fills in]',
  "What I'm going to do: [user fills in]",
];

const GATE3_ENCROACHMENT_REGEX =
  /Apple Intelligence|Screen Time|Focus Mode|Digital Wellbeing/i;

const TIER_S_OR_A = new Set(['S', 'A']);

// ---------------------------------------------------------------------------
// Types & result printing
// ---------------------------------------------------------------------------

interface AssertionResult {
  id: number;
  name: string;
  passed: boolean;
  detail: string; // shown after the dotted padding
  failureLines?: string[]; // additional indented lines printed on FAIL
}

const DOT_WIDTH = 56;

function formatLine(r: AssertionResult): string {
  const label = `Assertion ${r.id}: ${r.name}`;
  const padCount = Math.max(3, DOT_WIDTH - label.length);
  const dots = '.'.repeat(padCount);
  const status = r.passed ? 'PASS' : 'FAIL';
  const detail = r.detail ? ` (${r.detail})` : '';
  return `[T20] ${label} ${dots} ${status}${detail}`;
}

function printResult(r: AssertionResult): void {
  console.log(formatLine(r));
  if (!r.passed && r.failureLines) {
    for (const line of r.failureLines) {
      console.log(`        ${line}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Load inputs
// ---------------------------------------------------------------------------

const markdown = readFileSync(ARTIFACT_PATH, 'utf-8');
const toolResponseRaw = readFileSync(TOOL_RESPONSE_PATH, 'utf-8');
const toolResponse = JSON.parse(toolResponseRaw) as {
  status?: string;
  markdown?: string;
  issues?: Array<{ severity: string; code: string; message: string }>;
};

// ---------------------------------------------------------------------------
// Helpers for markdown parsing
// ---------------------------------------------------------------------------

/**
 * Extract the contents of a section delimited by `## <heading>` until the
 * next `## ` (top-level section) heading or EOF.
 */
function extractSection(md: string, headingMatcher: RegExp): string | null {
  const lines = md.split('\n');
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('## ') && headingMatcher.test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

/**
 * Extract a `### Gate N:` subsection from inside the Evidence Report section.
 */
function extractGateSubsection(
  evidenceReport: string,
  gateNumber: number,
): string | null {
  const lines = evidenceReport.split('\n');
  let start = -1;
  const headerRe = new RegExp(`^### Gate ${gateNumber}:`);
  for (let i = 0; i < lines.length; i++) {
    if (headerRe.test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith('### Gate ')) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

/**
 * Extract the DOK 1 fact bullets from a gate subsection. Returns the raw
 * text of each bullet (after the leading `- `), up to but not including the
 * `#### DOK 2` heading.
 */
function extractDok1FactBullets(gateSection: string): string[] {
  const lines = gateSection.split('\n');
  let inDok1 = false;
  const out: string[] = [];
  let current: string | null = null;
  for (const line of lines) {
    if (/^#### DOK 1\b/.test(line)) {
      inDok1 = true;
      continue;
    }
    if (inDok1 && line.startsWith('#### ') && !/^#### DOK 1\b/.test(line)) {
      // End of DOK 1 block (DOK 2 or other subheader)
      if (current !== null) {
        out.push(current.trim());
        current = null;
      }
      break;
    }
    if (!inDok1) continue;
    if (line.startsWith('- ')) {
      if (current !== null) {
        out.push(current.trim());
      }
      current = line.slice(2);
    } else if (current !== null && line.trim() !== '') {
      // continuation line of the current bullet
      current += ' ' + line.trim();
    } else if (current !== null && line.trim() === '') {
      // blank line — flush
      out.push(current.trim());
      current = null;
    }
  }
  if (current !== null) {
    out.push(current.trim());
  }
  return out;
}

/**
 * Extract the killshot bullets from the Verdict section. Each killshot is a
 * top-level `- ` bullet under the `### Killshot reasons` subheading. URLs
 * appear inside angle-bracketed lists `(<url1>, <url2>, ...)` at the tail.
 */
function extractKillshots(verdictSection: string): Array<{
  text: string;
  citedUrls: string[];
}> {
  const lines = verdictSection.split('\n');
  let inKillshots = false;
  const killshots: Array<{ text: string; citedUrls: string[] }> = [];
  let current: string | null = null;

  for (const line of lines) {
    if (/^### Killshot reasons/i.test(line)) {
      inKillshots = true;
      continue;
    }
    if (!inKillshots) continue;
    if (line.startsWith('###') || line.startsWith('## ')) {
      break;
    }
    // Stop when we hit a non-bullet/non-continuation line that isn't blank
    if (line.startsWith('- ')) {
      if (current !== null) {
        killshots.push(parseKillshot(current));
      }
      current = line.slice(2);
    } else if (current !== null) {
      if (line.trim() === '') {
        killshots.push(parseKillshot(current));
        current = null;
      } else if (!line.startsWith('Overall confidence:')) {
        current += ' ' + line.trim();
      } else {
        // Overall confidence line — flush current and stop
        killshots.push(parseKillshot(current));
        current = null;
        break;
      }
    }
  }
  if (current !== null) {
    killshots.push(parseKillshot(current));
  }
  return killshots;
}

function parseKillshot(rawText: string): { text: string; citedUrls: string[] } {
  // URLs appear as <https://...>; extract every one.
  const urlMatches = rawText.match(/<(https?:\/\/[^>\s]+)>/g) ?? [];
  const citedUrls = urlMatches.map((m) => m.slice(1, -1));
  return { text: rawText, citedUrls };
}

/**
 * Parse the Source Appendix table into a `url -> tier` map. Entries look like:
 *   N. <url> — Tier: S | Bias: ... | Fetched: ... | Contribution: ...
 */
function parseSourceAppendix(md: string): Map<string, string> {
  const section = extractSection(md, /^## Section 7: Source Appendix/);
  const map = new Map<string, string>();
  if (!section) return map;
  const lineRe = /^\s*\d+\.\s+(\S+)\s+[—–-]\s+Tier:\s+([SABCD])\b/;
  for (const line of section.split('\n')) {
    const m = line.match(lineRe);
    if (m) {
      map.set(m[1], m[2]);
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Assertion 1 — Verdict is NO-GO
// ---------------------------------------------------------------------------

function assertVerdict(): AssertionResult {
  const section = extractSection(markdown, /^## Section 2: Verdict/);
  if (!section) {
    return {
      id: 1,
      name: 'Verdict NO-GO',
      passed: false,
      detail: '',
      failureLines: [
        `Could not locate "## Section 2: Verdict" heading in ${ARTIFACT_PATH}`,
      ],
    };
  }
  // The renderer emits `**NO-GO**` on its own line under the heading.
  const verdictLine = section
    .split('\n')
    .map((l) => l.trim())
    .find((l) => /^\*\*(NO-GO|GO|INCONCLUSIVE)\*\*$/.test(l));
  const verdict = verdictLine
    ? verdictLine.replace(/\*\*/g, '').trim()
    : '<not found>';
  const passed = verdict === 'NO-GO';
  return {
    id: 1,
    name: 'Verdict NO-GO',
    passed,
    detail: passed ? 'verdict=NO-GO' : '',
    failureLines: passed
      ? undefined
      : [`EXPECTED: NO-GO, GOT: ${verdict}`],
  };
}

// ---------------------------------------------------------------------------
// Assertion 2 — At least 2 distinct cited URLs across all killshots have
// tier ∈ {S, A} (per PLAN.md T20 assertion 2 — mechanical Source Appendix
// cross-reference). Each individual killshot must also be grounded with at
// least one tier-S/A citation so that no killshot rests entirely on tier-B
// or below.
// ---------------------------------------------------------------------------

function assertKillshotTiers(
  killshots: Array<{ text: string; citedUrls: string[] }>,
  appendix: Map<string, string>,
): AssertionResult {
  if (killshots.length === 0) {
    return {
      id: 2,
      name: 'Killshots cite ≥2 tier S/A',
      passed: false,
      detail: '',
      failureLines: ['No killshots parsed from Verdict section.'],
    };
  }
  const distinctSA = new Set<string>();
  const failures: string[] = [];
  let perKillshotOk = 0;
  for (let i = 0; i < killshots.length; i++) {
    const k = killshots[i];
    if (k.citedUrls.length === 0) {
      failures.push(`Killshot ${i + 1}: no cited URLs found in bullet text.`);
      continue;
    }
    const tiers = k.citedUrls.map((u) => ({
      url: u,
      tier: appendix.get(u) ?? '<not in appendix>',
    }));
    const saInThis = tiers.filter((t) => TIER_S_OR_A.has(t.tier));
    for (const t of saInThis) distinctSA.add(t.url);
    if (saInThis.length === 0) {
      // Killshot rests entirely on tier B/C/D/unknown — that violates spec
      // §11 ("killshot reasons cite specific DOK 1 facts, not DOK 3 vibes").
      const detail = tiers.map((t) => `${t.url} (tier=${t.tier})`).join('; ');
      failures.push(
        `Killshot ${i + 1} has no tier-S/A citation. Cited: ${detail}`,
      );
    } else {
      perKillshotOk += 1;
    }
  }
  const totalSA = distinctSA.size;
  const distinctOk = totalSA >= 2;
  const passed = failures.length === 0 && distinctOk;
  if (!distinctOk) {
    failures.push(
      `Need ≥2 distinct tier-S/A cited URLs across killshots; found ${totalSA}.`,
    );
  }
  return {
    id: 2,
    name: 'Killshots cite ≥2 tier S/A',
    passed,
    detail: passed
      ? `${totalSA} distinct tier-S/A URLs across ${perKillshotOk}/${killshots.length} killshots`
      : '',
    failureLines: passed ? undefined : failures,
  };
}

// ---------------------------------------------------------------------------
// Assertion 3 — Gate 3 references Apple Intelligence / Screen Time / Focus
// Mode / Digital Wellbeing in DOK 1 facts (H6 vs M5 boundary)
// ---------------------------------------------------------------------------

function assertGate3Encroachment(): AssertionResult {
  const evidence = extractSection(markdown, /^## Section 3: Evidence Report/);
  if (!evidence) {
    return {
      id: 3,
      name: 'Gate 3 references encroachment kws',
      passed: false,
      detail: '',
      failureLines: ['Could not locate "## Section 3: Evidence Report".'],
    };
  }
  const gate3 = extractGateSubsection(evidence, 3);
  if (!gate3) {
    return {
      id: 3,
      name: 'Gate 3 references encroachment kws',
      passed: false,
      detail: '',
      failureLines: ['Could not locate "### Gate 3:" subsection.'],
    };
  }
  const facts = extractDok1FactBullets(gate3);
  const matched = facts.find((f) => GATE3_ENCROACHMENT_REGEX.test(f));
  if (matched) {
    const m = matched.match(GATE3_ENCROACHMENT_REGEX);
    const matchedKeyword = m ? m[0] : '<keyword>';
    return {
      id: 3,
      name: 'Gate 3 references encroachment kws',
      passed: true,
      detail: `matched: "${matchedKeyword}"`,
    };
  }
  const failureLines = [
    `Searched: ${GATE3_ENCROACHMENT_REGEX}`,
    'Gate 3 DOK 1 facts found:',
    ...facts.map((f) => `  - "${f.length > 200 ? f.slice(0, 197) + '...' : f}"`),
    'Recommendation: improve check_big_tech_encroachment keyword fan-out OR re-run with explicit_platforms',
  ];
  return {
    id: 3,
    name: 'Gate 3 references encroachment kws',
    passed: false,
    detail: '',
    failureLines,
  };
}

// ---------------------------------------------------------------------------
// Assertion 4 — Tool call count line present in Methodology Notes; N ≤ 20
// ---------------------------------------------------------------------------

function assertToolCallCount(): AssertionResult {
  const methodology = extractSection(markdown, /^## Section 8: Methodology Notes/);
  if (!methodology) {
    return {
      id: 4,
      name: 'Tool call count line present',
      passed: false,
      detail: '',
      failureLines: ['Could not locate "## Section 8: Methodology Notes".'],
    };
  }
  const m = methodology.match(/Tool calls fired:\s*(\d+)/);
  if (!m) {
    return {
      id: 4,
      name: 'Tool call count line present',
      passed: false,
      detail: '',
      failureLines: [
        'No "Tool calls fired: N" line found in Methodology Notes.',
      ],
    };
  }
  const count = parseInt(m[1], 10);
  const passed = count <= 20;
  return {
    id: 4,
    name: 'Tool call count line present',
    passed,
    detail: passed ? `${count} calls, ≤20 ✓` : `${count} calls, > 20 ceiling`,
    failureLines: passed
      ? undefined
      : [`§11 DoD ceiling: 20. Got: ${count}.`],
  };
}

// ---------------------------------------------------------------------------
// Assertion 5 — Killshot count ≥ 2
// ---------------------------------------------------------------------------

function assertKillshotCount(
  killshots: Array<{ text: string; citedUrls: string[] }>,
): AssertionResult {
  const passed = killshots.length >= 2;
  return {
    id: 5,
    name: 'Killshot count ≥ 2',
    passed,
    detail: passed ? `${killshots.length} killshots` : `${killshots.length} killshots`,
    failureLines: passed
      ? undefined
      : [
          `Spec §5: NO-GO requires 2-3 specific findings with citations. Found ${killshots.length}.`,
        ],
  };
}

// ---------------------------------------------------------------------------
// Assertion 6 — Spiky POV blank template integrity (defense-in-depth)
// ---------------------------------------------------------------------------

function assertSpikyPov(): AssertionResult {
  const section = extractSection(markdown, /^## Section 6: Your Spiky POV/);
  if (!section) {
    return {
      id: 6,
      name: 'Spiky POV blank template intact',
      passed: false,
      detail: '',
      failureLines: ['Could not locate "## Section 6: Your Spiky POV".'],
    };
  }
  const missing = SPIKY_POV_BLANK_TEMPLATE_LINES.filter(
    (line) => !section.includes(line),
  );
  const passed = missing.length === 0;
  return {
    id: 6,
    name: 'Spiky POV blank template intact',
    passed,
    detail: passed ? '' : '',
    failureLines: passed
      ? undefined
      : [
          'Missing canonical template line(s):',
          ...missing.map((l) => `  - "${l}"`),
          'See src/validation/constants.ts SPIKY_POV_BLANK_TEMPLATE.',
        ],
  };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const verdictSection = extractSection(markdown, /^## Section 2: Verdict/) ?? '';
const killshots = extractKillshots(verdictSection);
const appendix = parseSourceAppendix(markdown);

const results: AssertionResult[] = [
  assertVerdict(),
  assertKillshotTiers(killshots, appendix),
  assertGate3Encroachment(),
  assertToolCallCount(),
  assertKillshotCount(killshots),
  assertSpikyPov(),
];

for (const r of results) {
  printResult(r);
}

const passCount = results.filter((r) => r.passed).length;
const total = results.length;
console.log('');
if (passCount === total) {
  console.log(
    `[T20] OVERALL: ${passCount}/${total} assertions passed — Phase 01 Critical Test ✓`,
  );
  process.exit(0);
} else {
  const failedIds = results.filter((r) => !r.passed).map((r) => r.id).join(', ');
  console.log(
    `[T20] OVERALL: ${passCount}/${total} assertions passed — Phase 01 Critical Test FAILED on assertion ${failedIds}`,
  );
  console.error(`T20 FAILED: assertion(s) ${failedIds}`);
  process.exit(1);
}

// Suppress "unused" warnings for the tool-response import (parsed for future
// structured assertions when the schema gains adjusted_report passthrough).
void toolResponse;
