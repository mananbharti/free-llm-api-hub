#!/usr/bin/env node
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { changelogDraft } from './lib/changelog-draft.mjs';
try {
  console.log(changelogDraft({ cwd: join(dirname(fileURLToPath(import.meta.url)), '..') }));
} catch (e) {
  console.error(`Cannot draft changelog: ${e.message}`);
  process.exitCode = 1;
}
