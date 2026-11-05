import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeTmpDir } from './lib/tmp.mjs';
import { changelogDraft } from './lib/changelog-draft.mjs';

function fixture() {
  const cwd = makeTmpDir('changelog-draft-');
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  git('init'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  mkdirSync(join(cwd, 'data'));
  const data = { providers: [{ slug: 'acme', name: 'Acme', free_tier: 'old', rate_limits: '1 req/min' }] };
  const save = (message) => {
    writeFileSync(join(cwd, 'data/providers.json'), JSON.stringify(data));
    git('add', '.');
    execFileSync('git', ['commit', '-m', message], { cwd, env: { ...process.env, GIT_AUTHOR_DATE: '2026-10-01T12:00:00Z', GIT_COMMITTER_DATE: '2026-10-01T12:00:00Z' }, stdio: 'pipe' });
  };
  save('baseline'); git('tag', 'v1.0.0');
  return { cwd, git, data, save };
}

test('draft: two same-day commits after a tag, grouped by field/provider, with no writes', () => {
  const f = fixture();
  f.data.providers[0].free_tier = 'new'; f.save('tier');
  f.data.providers[0].rate_limits = '2 req/min'; f.save('rate');
  const before = f.git('status', '--porcelain');
  const contents = readFileSync(join(f.cwd, 'data/providers.json'), 'utf8');
  const result = changelogDraft(f);
  assert.match(result, /Since tag: v1.0.0. Last tracked change: 2026-10-01/);
  assert.match(result, /### free tier\n\n- \*\*Acme\*\* \(acme\):\n  - 2026-10-01: old → new/);
  assert.match(result, /### rate limits\n\n- \*\*Acme\*\* \(acme\):\n  - 2026-10-01: 1 req\/min → 2 req\/min/);
  assert.equal(result, changelogDraft(f));
  assert.equal(f.git('status', '--porcelain'), before);
  assert.equal(readFileSync(join(f.cwd, 'data/providers.json'), 'utf8'), contents);
});

test('draft: tag at HEAD has no changes; a missing tag fails rather than inventing a range', () => {
  const f = fixture();
  assert.match(changelogDraft(f), /No tracked field changes since this tag/);
  f.git('tag', '-d', 'v1.0.0');
  assert.throws(() => changelogDraft(f), /describe|names|tags/i);
});

test('draft: uses the latest reachable tag; does not include earlier changes', () => {
  const f = fixture();
  f.data.providers[0].free_tier = 'released'; f.save('released'); f.git('tag', 'v2.0.0');
  f.data.providers[0].free_tier = 'next'; f.save('next');
  const result = changelogDraft(f);
  assert.match(result, /Since tag: v2.0.0/);
  assert.match(result, /released → next/);
  assert.doesNotMatch(result, /old → released/);
});

test('draft: unknown flags stay unknown and Markdown content cannot create extra headings', () => {
  const f = fixture();
  f.data.providers[0].commercial_ok = false;
  f.data.providers[0].name = 'Acme [preview]';
  f.data.providers[0].notes = 'first line\n# not a heading';
  f.save('flags and text');
  const result = changelogDraft(f);
  assert.match(result, /unknown → no/);
  assert.match(result, /Acme \\\[preview\\\]/);
  assert.match(result, /first line \\# not a heading/);
  assert.doesNotMatch(result, /\n# not a heading/);
});
