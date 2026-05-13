#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

// Tools
import { registerFindClosestCompetitor } from './tools/find-closest-competitor.js';
import { registerReadCompetitorChangelog } from './tools/read-competitor-changelog.js';
import { registerMapCompetitiveWeaknesses } from './tools/map-competitive-weaknesses.js';
import { registerScanProductHuntLaunches } from './tools/scan-producthunt-launches.js';
import { registerGetCategoryFailureModes } from './tools/get-category-failure-modes.js';
import { registerFindYCRFSAlignment } from './tools/find-yc-rfs-alignment.js';

// Prompts
import { registerValidateIdeaPrompt } from './prompts/validate-idea.js';
import { registerCheckBigTechRiskPrompt } from './prompts/check-bigtech-risk.js';
import { registerSniffUnitEconomicsPrompt } from './prompts/sniff-unit-economics.js';
import { registerAssessFounderEdgePrompt } from './prompts/assess-founder-edge.js';
import { registerGenerateDiscoveryQuestionsPrompt } from './prompts/generate-discovery-questions.js';

const server = new McpServer({
  name: 'product-validation',
  version: '0.1.0',
});

// --- Register Tools ---
// Data tools: return live signals Claude can't fabricate
registerFindClosestCompetitor(server);
registerReadCompetitorChangelog(server);
registerMapCompetitiveWeaknesses(server);
registerScanProductHuntLaunches(server);
registerGetCategoryFailureModes(server);
registerFindYCRFSAlignment(server);

// --- Register Prompts ---
// Framework tools: bake the pre-build checklist into reusable analytical workflows
registerValidateIdeaPrompt(server);
registerCheckBigTechRiskPrompt(server);
registerSniffUnitEconomicsPrompt(server);
registerAssessFounderEdgePrompt(server);
registerGenerateDiscoveryQuestionsPrompt(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('ProductValidation MCP running on stdio');
  console.error('Tools: find_closest_competitor, read_competitor_changelog, map_competitive_weaknesses, scan_producthunt_launches, get_category_failure_modes, find_yc_rfs_alignment');
  console.error('Prompts: validate_idea, check_bigtech_risk, sniff_unit_economics, assess_founder_edge, generate_discovery_questions');
  console.error('Stubs active for: Serper, Reddit, ProductHunt — set API keys to activate live data');
}

main().catch((error) => {
  console.error('Fatal error in main():', error);
  process.exit(1);
});
