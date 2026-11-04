import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { baselineForPage, evaluate, medianReport, THRESHOLDS } from './lib/lighthouse-gate.mjs';

const report = (accessibility, performance) => ({ categories: { accessibility: { score: accessibility }, performance: { score: performance } } });
const a11yReport = (auditScore, baselineScore = 1) => ({
  categories: {
    accessibility: { score: baselineScore, auditRefs: [{ id: 'label', weight: 3 }] },
    performance: { score: 1 },
  },
  audits: {
    label: {
      score: auditScore,
      title: 'Form elements do not have associated labels',
      details: { items: [{ node: { snippet: '<input id="email">' } }] },
    },
  },
});

test('scores at or above the thresholds pass', () => {
  assert.deepEqual(evaluate('/', report(THRESHOLDS.accessibility, THRESHOLDS.performance)), []);
});

test('accessibility just below the threshold fails and names the page', () => {
  const f = evaluate('/best/', report(0.94, 1));
  assert.equal(f.length, 1);
  assert.match(f[0], /^\/best\/: accessibility 0\.94 is below 0\.95$/);
});

test('performance just below the threshold fails', () => {
  assert.equal(evaluate('/', report(1, 0.79)).length, 1);
});

test('a missing or null score is a failure, not a pass', () => {
  assert.equal(evaluate('/', { categories: { accessibility: { score: null }, performance: { score: 1 } } }).length, 1);
  assert.equal(evaluate('/', { categories: {} }).length, 2);
  assert.equal(evaluate('/', undefined).length, 2);
});


test('a new failing accessibility audit fails and names the audit and node', () => {
  const failures = evaluate('/', a11yReport(0));
  assert.deepEqual(failures, ['/: accessibility audit label failed: Form elements do not have associated labels (<input id="email">)']);
});

test('the same failing audit passes when the page baseline names it', () => {
  assert.deepEqual(evaluate('/', a11yReport(0), undefined, ['label']), []);
});

test('a null accessibility audit result is a failure, as a null category score already is', () => {
  assert.deepEqual(evaluate('/', a11yReport(null)), ['/: accessibility audit label failed: Form elements do not have associated labels (<input id="email">)']);
});

test('the median keeps an audit failure from any run instead of averaging it away', () => {
  const median = medianReport([report(1, 1), a11yReport(0), report(1, 1)]);
  assert.deepEqual(evaluate('/best/', median), ['/best/: accessibility audit label failed: Form elements do not have associated labels (<input id="email">)']);
  assert.deepEqual(evaluate('/best/', median, undefined, ['label']), []);
});

test('the committed accessibility baseline is page to audit ids and records the existing contrast failure', () => {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
  const baseline = JSON.parse(readFileSync(join(ROOT, 'data/a11y-baseline.json'), 'utf8'));
  for (const ids of Object.values(baseline)) assert.ok(Array.isArray(ids) && ids.every((id) => typeof id === 'string'));
  assert.ok(baselineForPage(baseline, '/').includes('color-contrast'));
  assert.deepEqual(baselineForPage({ '/': ['label', 3] }, '/'), ['label']);
});

test('the median of three runs ignores one bad run', () => {
  const m = medianReport([report(1, 0.78), report(1, 0.91), report(1, 0.93)]);
  assert.equal(m.categories.performance.score, 0.91);
  assert.deepEqual(evaluate('/', m), []);
});

test('two bad runs out of three still fail', () => {
  const m = medianReport([report(1, 0.78), report(1, 0.79), report(1, 0.93)]);
  assert.equal(evaluate('/', m).length, 1);
});

test('a run without a score makes the median "no score"', () => {
  const m = medianReport([report(1, 0.9), { categories: {} }, report(1, 0.9)]);
  assert.equal(evaluate('/', m).length, 2);
});

// The pages the gate measures are written in two places, the script and the comment of the workflow. They must agree,
// and the pages that carry the tables and the comparison have to be among them.
test('the gate measures /free-gpu/ and /coding-tools/, and the workflow says which pages it measures', () => {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
  const script = readFileSync(join(ROOT, 'scripts/lighthouse-gate.mjs'), 'utf8');
  const workflow = readFileSync(join(ROOT, '.github/workflows/lighthouse.yml'), 'utf8');
  const list = script.match(/const pages = \[([^\]]*)\];/);
  assert.ok(list, 'the page list is found in the script');
  const fixed = [...list[1].matchAll(/'(\/[^']*)'/g)].map((m) => m[1]);
  for (const page of ['/compare/', '/data-policy/', '/free-gpu/', '/guides-and-collections/', '/coding-tools/']) assert.ok(fixed.includes(page), `the gate measures ${page}`);
  for (const page of fixed.filter((p) => p !== '/')) assert.ok(workflow.includes(page), `the workflow names ${page}`);
  // one more page than the fixed ones: the provider page comes from the dataset
  const count = fixed.length + 1;
  const words = { 4: 'four', 5: 'five', 6: 'six', 7: 'seven', 8: 'eight', 9: 'nine' };
  assert.ok(workflow.includes(`on ${words[count]} pages`) && workflow.includes(`Measure the ${words[count]} pages`), `the workflow says ${words[count]} pages`);
});
