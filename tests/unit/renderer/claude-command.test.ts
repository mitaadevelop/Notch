import { describe, expect, test } from 'vitest';
import { claudeCodeCommand } from '../../../src/js/claude.ts';

const status = {
  command: '/Applications/Agenda.app/Contents/MacOS/Agenda',
  args: ['/Applications/Agenda.app/Contents/Resources/app.asar/dist/mcp.js'],
  env: { ELECTRON_RUN_AS_NODE: '1', AGENDA_USER_DATA: '/Users/sam/Library/Application Support/Agenda' },
};

describe('claudeCodeCommand', () => {
  test('een opdracht met omgeving, het programma en het script, en quotes om spaties', () => {
    expect(claudeCodeCommand(status)).toBe(
      "claude mcp add agenda -e ELECTRON_RUN_AS_NODE='1' -e AGENDA_USER_DATA='/Users/sam/Library/Application Support/Agenda' -- '/Applications/Agenda.app/Contents/MacOS/Agenda' '/Applications/Agenda.app/Contents/Resources/app.asar/dist/mcp.js'",
    );
  });

  test('een apostrof in een pad breekt de opdracht niet', () => {
    const cmd = claudeCodeCommand({ ...status, env: { A: "it's" } });
    expect(cmd).toContain(`-e A='it'\\''s'`);
  });

  test('op Windows met dubbele quotes', () => {
    const cmd = claudeCodeCommand(
      { command: 'C:\\Program Files\\Agenda\\Agenda.exe', args: ['x.js'], env: { A: '1' } },
      true,
    );
    expect(cmd).toBe('claude mcp add agenda -e A="1" -- "C:\\Program Files\\Agenda\\Agenda.exe" "x.js"');
  });
});
