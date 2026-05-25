#!/usr/bin/env node
import { config as loadDotenv } from 'dotenv';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load .env from the package root (one level up from build/ or src/).
// Works regardless of cwd — Claude Desktop spawns from /, dev runs from anywhere.
// quiet: true is critical — dotenv v17+ logs "injected env (N)" to stdout by default,
// which corrupts the JSON-RPC channel the MCP server uses over stdio.
loadDotenv({
  path: join(dirname(fileURLToPath(import.meta.url)), '..', '.env'),
  quiet: true,
});

// Tools
import { registerFindClosestCompetitor } from './tools/find-closest-competitor.js';
import { registerReadCompetitorChangelog } from './tools/read-competitor-changelog.js';
import { registerMapCompetitiveWeaknesses } from './tools/map-competitive-weaknesses.js';
import { registerScanProductHuntLaunches } from './tools/scan-producthunt-launches.js';
import { registerGetCategoryFailureModes } from './tools/get-category-failure-modes.js';
import { registerFindYCRFSAlignment } from './tools/find-yc-rfs-alignment.js';
import { registerFindPricingAnchors } from './tools/find-pricing-anchors.js';
import { registerCheckBigTechEncroachment } from './tools/check-big-tech-encroachment.js';
import { registerFindWhyNowSignals } from './tools/find-why-now-signals.js';
import { registerEstimateDemandSignals } from './tools/estimate-demand-signals.js';
import { registerFindPublicRevenueSignals } from './tools/find-public-revenue-signals.js';
import { registerFinalizeValidationReport } from './tools/finalize-validation-report.js';

// Prompts
import { registerValidateIdeaPrompt } from './prompts/validate-idea.js';
import { registerSteelmanAgainstPrompt } from './prompts/steelman-against.js';
import { registerRunSingleGatePrompt } from './prompts/run-single-gate.js';
import { registerGenerateTestCardsPrompt } from './prompts/generate-test-cards.js';
import { registerQuickKillCheckPrompt } from './prompts/quick-kill-check.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Load a resource file fresh per invocation — not cached at startup.
 * Per MCP spec: resources must be loaded fresh per invocation of the master prompt.
 */
function loadResource(filename: string): string {
  return readFileSync(join(__dirname, '..', 'src', 'resources', filename), 'utf-8');
}

const server = new McpServer({
  name: 'product-validation',
  version: '0.1.0',
});

// Resources — loaded fresh per request (not at import time)
server.resource('source-tier-bias', 'resource://source-tier-bias', async () => ({
  contents: [
    {
      uri: 'resource://source-tier-bias',
      mimeType: 'text/markdown',
      text: loadResource('source-tier-bias.md'),
    },
  ],
}));

server.resource('tool-to-gate-map', 'resource://tool-to-gate-map', async () => ({
  contents: [
    {
      uri: 'resource://tool-to-gate-map',
      mimeType: 'text/markdown',
      text: loadResource('tool-to-gate-map.md'),
    },
  ],
}));

server.resource('evaluation-lens-matrix', 'resource://evaluation-lens-matrix', async () => ({
  contents: [
    {
      uri: 'resource://evaluation-lens-matrix',
      mimeType: 'text/markdown',
      text: loadResource('evaluation-lens-matrix.md'),
    },
  ],
}));

// Register tools
registerFindClosestCompetitor(server);
registerReadCompetitorChangelog(server);
registerMapCompetitiveWeaknesses(server);
registerScanProductHuntLaunches(server);
registerGetCategoryFailureModes(server);
registerFindYCRFSAlignment(server);
registerFindPricingAnchors(server);
registerCheckBigTechEncroachment(server);
registerFindWhyNowSignals(server);
registerEstimateDemandSignals(server);
registerFindPublicRevenueSignals(server);
registerFinalizeValidationReport(server);

// Register prompts
registerValidateIdeaPrompt(server);
registerSteelmanAgainstPrompt(server);
registerRunSingleGatePrompt(server);
registerGenerateTestCardsPrompt(server);
registerQuickKillCheckPrompt(server);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('ProductValidation MCP Server running on stdio');
  console.error(
    'Tools: find_closest_competitor, read_competitor_changelog, map_competitive_weaknesses, scan_producthunt_launches, get_category_failure_modes, find_yc_rfs_alignment, find_pricing_anchors, check_big_tech_encroachment, find_why_now_signals, estimate_demand_signals, finalize_validation_report'
  );
  console.error('Prompts: validate_idea, steelman_against, run_single_gate, generate_test_cards, quick_kill_check');
  console.error('Resources: source-tier-bias, tool-to-gate-map, evaluation-lens-matrix');
}

main().catch((error) => {
  console.error('Fatal error in main():', error);
  process.exit(1);
});
