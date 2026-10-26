// "Claude" in de voorkeuren: wat Claude mag, en Claude Desktop of Claude Code met de agenda verbinden
import type { McpStatus } from '../shared/types.ts';
import { $ } from './util.ts';

const f = {
  write: $<HTMLInputElement>('mcp-write'),
  notes: $<HTMLInputElement>('mcp-notes'),
  invitees: $<HTMLInputElement>('mcp-invitees'),
  install: $<HTMLButtonElement>('mcp-install'),
  copy: $<HTMLButtonElement>('mcp-copy'),
  status: $('mcp-status'),
};

let current: McpStatus | null = null;

const quote = (value: string, windows: boolean) =>
  windows ? `"${value.replace(/"/g, '\\"')}"` : `'${value.replace(/'/g, `'\\''`)}'`;

// de opdracht waarmee Claude Code de agenda-server toevoegt
export function claudeCodeCommand(status: Pick<McpStatus, 'command' | 'args' | 'env'>, windows = false) {
  const env = Object.entries(status.env).map(([key, value]) => `-e ${key}=${quote(value, windows)}`);
  return [
    'claude mcp add agenda',
    ...env,
    '--',
    quote(status.command, windows),
    ...status.args.map((a) => quote(a, windows)),
  ].join(' ');
}

function render(status: McpStatus) {
  current = status;
  f.write.checked = status.config.allowWrite;
  f.notes.checked = status.config.shareNotes;
  f.invitees.checked = status.config.shareInvitees;
  f.status.textContent = status.running
    ? 'De koppeling met Claude is actief zolang deze app draait.'
    : 'De koppeling met Claude kon niet starten.';
}

export async function initClaude(toast: (message: string) => void) {
  const change = async () => {
    render(
      await window.agenda.setMcp({
        allowWrite: f.write.checked,
        shareNotes: f.notes.checked,
        shareInvitees: f.invitees.checked,
      }),
    );
  };
  for (const box of [f.write, f.notes, f.invitees]) box.addEventListener('change', () => void change());

  f.install.addEventListener('click', async () => {
    try {
      const result = await window.agenda.installMcpForClaude();
      if (result.installed) {
        f.status.textContent = `Toegevoegd aan ${result.path}. Start Claude Desktop opnieuw op; daarna staat “agenda” bij de tools.`;
        toast('Agenda toegevoegd aan Claude Desktop.');
      }
    } catch (error) {
      f.status.textContent = `Toevoegen mislukt: ${(error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`;
    }
  });

  f.copy.addEventListener('click', async () => {
    if (!current) return;
    try {
      await navigator.clipboard.writeText(claudeCodeCommand(current, window.agenda.platform === 'win32'));
      toast('Opdracht gekopieerd. Plak hem in een terminal.');
    } catch {
      f.status.textContent = 'Kopiëren is niet gelukt.';
    }
  });

  render(await window.agenda.getMcp());
}
