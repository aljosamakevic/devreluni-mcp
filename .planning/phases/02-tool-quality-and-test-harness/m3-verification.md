# M3 Verification — Wayback URL audit

**Phase:** 02-tool-quality-and-test-harness
**Task:** T04
**Audit date:** 2026-05-25
**Auditor:** Phase 02 Wave 2 Stream A executor

## Concern under audit

CONCERNS.md M3: `find_pricing_anchors` Wayback URL is cited but not fetched.
Previously, the tool added wildcard Wayback URLs (e.g. `https://web.archive.org/web/2024*`)
to its `sources[]` without ever calling `waybackLookup()` — a fabrication anti-pattern
forbidden by spec §11.

## Audit method

### 1. Grep for wildcard Wayback URLs

```
grep -nE "https://web\.archive\.org/web/[0-9*]+\*" src/tools/find-pricing-anchors.ts
```

**Result:** 0 matches.

### 2. Stricter grep per PLAN.md T04 acceptance criterion

```
grep -nE "web\.archive\.org/web/[^0-9]" src/tools/find-pricing-anchors.ts
```

**Result:** 0 matches.

### 3. Inventory of remaining `web.archive.org` references

```
grep -n "web.archive.org" src/tools/find-pricing-anchors.ts
```

**Result:** 2 hits, both benign:

- **Line 231:** `const historyQuery = \`${competitor} pricing history site:web.archive.org\`;`
  — A Serper search query string. Not a source URL.
- **Line 245:** `} else if (historyResults.some((r) => r.link.includes('web.archive.org'))) {`
  — A snippet-filter check on Serper response links to flavor the `trend` field.
  Not a write into `sources[]`.

### 4. Source-construction logic

All `sources[]` entries citing `web.archive.org` flow through one path:

```ts
const snapshot = await waybackLookup(lookupTarget);
if (snapshot) {
  waybackFound += 1;
  const src = waybackSource(snapshot, /* contribution */);
  sources.push(src);
}
```

`waybackLookup()` returns `null` on miss/failure, and `waybackSource()`
builds the URL from the verified `snapshot.timestamp`. No wildcard path
exists for `sources.push()`.

### 5. Live smoke-test

```
find_pricing_anchors({
  category: "focus app",
  competitors: ["RescueTime", "Fomi-DoesNotExist", "Freedom"]
})
```

Wayback URLs returned in `sources[]`:

- `http://web.archive.org/web/20260510041848/https://www.rescuetime.com/pricing`
- `http://web.archive.org/web/20260328211625/https://ubos.tech/pricing/`
- `http://web.archive.org/web/20180720081744/https://freedom.to/pricing`

Every Wayback URL has a real 14-digit timestamp. No wildcards. No fabrications.

## Conclusion

**M3 verified closed by Phase 01 H8 fix (commit `d54ecf5`). No Phase 02 code change required.**

CONCERNS.md M3 has been annotated accordingly.
