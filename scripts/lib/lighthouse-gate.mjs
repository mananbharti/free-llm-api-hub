// lighthouse-gate.mjs — the pass/fail rule for the Lighthouse + accessibility CI gate.
//
// Pure on purpose: it takes parsed Lighthouse reports, a thresholds object and an
// audit baseline, and returns the failures, so the rule is unit-tested without a browser.
// A category that is missing or has a null score (Lighthouse could not compute it)
// is a failure, never a pass: "no score" must not read as "fine". The same is true
// of an accessibility audit with a null result.

export const THRESHOLDS = Object.freeze({ accessibility: 0.95, performance: 0.8 });

const auditNodes = (audit) => (audit.details?.items ?? [])
  .slice(0, 3)
  .map((item) => String(item.node?.snippet ?? item.node?.selector ?? '').replace(/\s+/g, ' ').slice(0, 160))
  .filter(Boolean);

/** Accessibility audits that failed in one Lighthouse report. Null is a failure too. */
export function failingA11yAudits(report) {
  const refs = report?.categories?.accessibility?.auditRefs ?? [];
  const failures = [];
  for (const ref of refs) {
    if (!ref || ref.weight === 0) continue;
    const audit = report?.audits?.[ref.id];
    if (!audit) continue;
    if (audit.score === 1) continue;
    if (audit.score !== null && (typeof audit.score !== 'number' || audit.score >= 1)) continue;
    failures.push({ id: ref.id, title: audit.title || ref.id, nodes: auditNodes(audit) });
  }
  return failures;
}

/** The audit ids a page is already known to fail; malformed entries are not a baseline. */
export function baselineForPage(baseline, page) {
  const value = baseline?.[page];
  return Array.isArray(value) ? value.filter((id) => typeof id === 'string') : [];
}

export function evaluate(url, report, thresholds = THRESHOLDS, baseline = []) {
  const failures = [];
  const categories = (report && report.categories) || {};
  for (const [name, minimum] of Object.entries(thresholds)) {
    const score = categories[name] ? categories[name].score : undefined;
    if (typeof score !== 'number') {
      failures.push(`${url}: ${name} has no score`);
    } else if (score < minimum) {
      failures.push(`${url}: ${name} ${score.toFixed(2)} is below ${minimum.toFixed(2)}`);
    }
  }
  const audits = Array.isArray(report?.a11yFailures) ? report.a11yFailures : failingA11yAudits(report);
  for (const audit of audits) {
    if (baseline.includes(audit.id)) continue;
    failures.push(`${url}: accessibility audit ${audit.id} failed: ${audit.title}${audit.nodes.length ? ` (${audit.nodes.join(' | ')})` : ''}`);
  }
  return failures;
}

// Lighthouse performance moves between runs on a shared runner (the home page scored
// 0.78 and then 0.91 in two CI runs of the same commit), so the gate judges the median
// of several runs. Audit failures are not averaged: a failure in any run is kept.
export function medianReport(reports) {
  const names = new Set(reports.flatMap((r) => Object.keys((r && r.categories) || {})));
  const categories = {};
  for (const name of names) {
    const scores = reports.map((r) => r && r.categories && r.categories[name] && r.categories[name].score);
    // One run without a score makes the median unreliable: keep it as "no score".
    if (scores.some((x) => typeof x !== 'number')) { categories[name] = { score: null }; continue; }
    const sorted = [...scores].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    categories[name] = { score: sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2 };
  }
  const byId = new Map();
  for (const report of reports) {
    for (const failure of failingA11yAudits(report)) if (!byId.has(failure.id)) byId.set(failure.id, failure);
  }
  return { categories, a11yFailures: [...byId.values()] };
}
