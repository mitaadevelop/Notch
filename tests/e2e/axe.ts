// axe-core rechtstreeks in de pagina draaien: @axe-core/playwright opent een extra pagina en dat kan Electron niet
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { AxeResults, Result, RunOptions } from 'axe-core';

const source = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

export async function runAxe(page: Page, options: RunOptions = {}): Promise<Result[]> {
  // evaluate met een string omzeilt de CSP (een <script>-tag zou geblokkeerd worden)
  await page.evaluate(source);
  const results = (await page.evaluate(
    (opts) =>
      (window as unknown as { axe: { run(c: Document, o: RunOptions): Promise<AxeResults> } }).axe.run(document, opts),
    options,
  )) as AxeResults;
  return results.violations;
}

export const describeViolations = (violations: Result[]) =>
  violations.map(
    (v) =>
      `${v.id} [${v.impact}] x${v.nodes.length}: ${v.nodes
        .slice(0, 3)
        .map((n) => n.target.join(' '))
        .join(' | ')}`,
  );
