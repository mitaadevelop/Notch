import { describe, expect, test } from 'vitest';
import { claudeDesktopConfigPath, mergeClaudeConfig } from '../../../src/mcp/claude-config.ts';

const entry = {
  command: '/Applications/Agenda.app/Contents/MacOS/Agenda',
  args: ['/x/dist/mcp.js'],
  env: { ELECTRON_RUN_AS_NODE: '1', AGENDA_USER_DATA: '/data' },
};

describe('mergeClaudeConfig', () => {
  test('maakt een nieuw bestand als er nog niets is', () => {
    const merged = JSON.parse(mergeClaudeConfig(null, entry));
    expect(merged).toEqual({ mcpServers: { agenda: entry } });
  });

  test('een leeg bestand telt als nieuw', () => {
    expect(JSON.parse(mergeClaudeConfig('  \n', entry))).toEqual({ mcpServers: { agenda: entry } });
  });

  test('laat andere servers en andere instellingen onaangeroerd', () => {
    const existing = JSON.stringify({ theme: 'dark', mcpServers: { files: { command: 'npx', args: ['x'] } } });
    const merged = JSON.parse(mergeClaudeConfig(existing, entry));
    expect(merged.theme).toBe('dark');
    expect(merged.mcpServers.files).toEqual({ command: 'npx', args: ['x'] });
    expect(merged.mcpServers.agenda).toEqual(entry);
  });

  test('vervangt een oudere "agenda"-vermelding (bijv. na een verhuizing van de app)', () => {
    const existing = JSON.stringify({ mcpServers: { agenda: { command: '/oud', args: [] } } });
    expect(JSON.parse(mergeClaudeConfig(existing, entry)).mcpServers.agenda).toEqual(entry);
  });

  test('een bestand zonder mcpServers krijgt die sectie', () => {
    expect(JSON.parse(mergeClaudeConfig('{"a":1}', entry))).toEqual({ a: 1, mcpServers: { agenda: entry } });
  });

  test.each([['{ kapot'], ['[1,2]'], ['"tekst"'], ['null'], ['42']])('overschrijft %s nooit', (existing) => {
    expect(() => mergeClaudeConfig(existing, entry)).toThrow(/JSON|opbouw/);
  });

  test('een mcpServers die geen object is wordt vervangen in plaats van mee te kopiëren', () => {
    const merged = JSON.parse(mergeClaudeConfig('{"mcpServers":[1,2]}', entry));
    expect(merged.mcpServers).toEqual({ agenda: entry });
  });

  test('eindigt met een regeleinde en is netjes ingesprongen', () => {
    const text = mergeClaudeConfig(null, entry);
    expect(text.endsWith('\n')).toBe(true);
    expect(text).toContain('\n  "mcpServers"');
  });
});

describe('claudeDesktopConfigPath', () => {
  test('per besturingssysteem de plek waar Claude Desktop zijn configuratie zoekt', () => {
    expect(claudeDesktopConfigPath('darwin', '/Users/sam')).toBe(
      '/Users/sam/Library/Application Support/Claude/claude_desktop_config.json',
    );
    expect(claudeDesktopConfigPath('linux', '/home/sam')).toMatch(/Claude[/\\]claude_desktop_config\.json$/);
    expect(claudeDesktopConfigPath('win32', 'C:\\Users\\sam')).toMatch(/Claude[/\\]claude_desktop_config\.json$/);
  });
});
