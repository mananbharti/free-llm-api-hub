// Read-only release notes from the same miner and field rows as changes.json.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mineHistorySince, HISTORY_FIELDS } from './history.mjs';
import { flattenFieldChanges, formatValue } from './changes.mjs';

const git = (cwd, args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.error || r.status !== 0) throw r.error || new Error(r.stderr.trim() || 'git failed');
  return r.stdout.trim();
};
const md = (s) => String(s).replace(/[\\`*_{}\[\]<>#|]/g, '\\$&').replace(/\s+/g, ' ');

export function changelogDraft({ cwd }) {
  if (git(cwd, ['rev-parse', '--is-shallow-repository']) === 'true') throw new Error('Use a full clone with tags, not a shallow checkout.');
  const tag = git(cwd, ['describe', '--tags', '--abbrev=0', 'HEAD']);
  const data = JSON.parse(readFileSync(join(cwd, 'data/providers.json'), 'utf8'));
  const names = Object.fromEntries((data.providers || []).map((p) => [p.slug, p.name]));
  const changes = flattenFieldChanges(mineHistorySince({ cwd, tag }), names);
  const last = changes[0]?.date || 'none';
  const lines = ['## Data changes (draft)', '', `Since tag: ${md(tag)}. Last tracked change: ${last}.`, '',
    'Only change-feed fields are included; review before pasting into CHANGELOG.md.', ''];
  if (!changes.length) return lines.concat('No tracked field changes since this tag.', '').join('\n');
  for (const [field, label] of Object.entries(HISTORY_FIELDS)) {
    const rows = changes.filter((c) => c.field === field);
    if (!rows.length) continue;
    lines.push(`### ${md(label)}`, '');
    for (const slug of [...new Set(rows.map((r) => r.slug))]) {
      const provider = rows.filter((r) => r.slug === slug);
      lines.push(`- **${md(provider[0].name)}** (${md(slug)}):`);
      for (const c of provider) lines.push(`  - ${c.date}: ${md(formatValue(c.from))} → ${md(formatValue(c.to))}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
