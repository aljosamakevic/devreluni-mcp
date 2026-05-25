# Source Tier and Bias Reference

This document defines how sources are classified in the Product Validation framework. Every DOK 1 fact must carry both a tier badge and a bias flag.

---

## Source Tier Table

| Tier | Name | Description | Examples |
|------|------|-------------|---------|
| **S** | Primary / First-Party / Immutable | Direct, authoritative, unambiguous evidence. Cannot be edited after the fact or is publicly verifiable at a point in time. | Competitor changelogs, SEC filings, Wayback Machine snapshots, official platform Terms of Service, GitHub commit history, live pricing pages fetched at a known timestamp |
| **A** | Strong Secondary / User-Generated at Scale | High-signal data produced by real users or third-party platforms with verifiable aggregation. Individually unverified but reliable in aggregate. | IndieHackers public revenue disclosures, Reddit subscriber counts, Product Hunt votes and comments, founder MRR tweets, SimilarWeb traffic estimates, HN discussion threads |
| **B** | Aggregated User Feedback | Structured aggregates of user experience. Reliable for pattern detection, not individual claims. | G2/Capterra review aggregates (50+ reviews), App Store review patterns, HN comment theme analysis, Glassdoor culture signals |
| **C** | Vendor-Funded Research | Research produced by parties with financial interest in the category. May be accurate but requires independent corroboration. | Gartner reports, Forrester Wave, vendor whitepapers, sponsored industry surveys |
| **D** | Marketing Material / Anonymous Opinion | Lowest signal. Useful only to flag concerns or surface hypotheses, never to validate claims. | Vendor landing page copy, anonymous forum posts (unverified), unattributed blog posts, social media speculation |

---

## Bias Flag Table

| Flag | Description | When to Apply |
|------|-------------|---------------|
| **independent** | No financial, organizational, or competitive stake in the claim | Academic research, user review aggregators, journalist investigations, independent analysts |
| **vendor-funded** | Source is paid by a participant in the category being analyzed | Gartner (vendor-sponsored), whitepapers, sponsored "state of the market" reports |
| **conflicted** | Source has a direct stake — is a competitor, partner, investor, or employee | Competitor's own pricing page, a competitor's changelog, a founder's tweet about their MRR, a funded investor's blog post |
| **unknown** | Cannot determine the source's financial or organizational relationship | Anonymous forums, unattributed blog posts, third-party aggregators without disclosed methodology |

**Runtime rule:** `unknown` bias must be treated as `vendor-funded` for all gate evaluation purposes.

---

## Decision Rules

1. **PASS requires quality floor:** A gate PASS requires at least 2 tier-B-or-higher sources supporting the conclusion. C/D-only evidence = automatic Inconclusive.

2. **Conflicted source penalty:** If more than 30% of the deciding-tier sources for a gate verdict are flagged `conflicted`, downgrade that gate's confidence by one level (e.g., High → Medium, Medium → Low).

3. **D-tier scope:** D-tier sources never validate a claim. They may only flag concerns or generate hypotheses for further investigation. Do not cite a D-tier source to support a PASS verdict.

4. **Unknown = vendor-funded:** Treat `unknown` bias sources identically to `vendor-funded` in all calculations, including the 30% conflicted-source penalty.

5. **S-tier independent outweighs C-tier vendor-funded:** A single S-tier independent source (e.g., a Wayback Machine snapshot of a competitor's pricing page) outweighs multiple C-tier vendor-funded sources on the same claim.

6. **Conflicted sources as positioning evidence:** Conflicted sources (e.g., a competitor's own changelog or pricing page) remain valid as evidence of that competitor's self-reported positioning — they are just not valid as independent validation.

---

## Runtime Fact Citation Format

Every DOK 1 fact in a Validation Report must include:

```
[Fact text] — Source: [URL] | Tier: [S/A/B/C/D] | Bias: [independent/vendor-funded/conflicted/unknown] | Fetched: [YYYY-MM-DD]
```

Example:
```
Competitor X charges $29/mo for their starter plan. — Source: https://competitorx.com/pricing | Tier: S | Bias: conflicted | Fetched: 2026-05-19
```

---

## Summary: Tier Usage in Practice

- Use **S** when you have fetched a live page or archival snapshot with a timestamp.
- Use **A** when citing aggregated platform data (PH votes, HN scores, Reddit subscriber counts).
- Use **B** when citing patterns extracted from review sites or community aggregates.
- Use **C** when citing analyst reports or any vendor-sponsored research.
- Use **D** only to flag a potential concern, never to validate.
- When in doubt between tiers, assign the lower tier.
