import { fireEvent, screen, within } from '@testing-library/dom';
import { beforeEach, describe, expect, test } from 'vitest';
import { freshModules, installAgenda, loadPage } from './dom.ts';

let agenda: ReturnType<typeof installAgenda>;
beforeEach(() => {
  loadPage();
  agenda = installAgenda();
  // jsdom kent show() niet voor niet-modale dialogen
  HTMLDialogElement.prototype.show = function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const log = () => document.getElementById('chat-log')!;
const dialog = () => document.getElementById('chat-dialog') as HTMLDialogElement;
const input = () => document.getElementById('chat-input') as HTMLTextAreaElement;

async function setup() {
  await freshModules();
  const chat = await import('../../../src/js/chatview.ts');
  chat.initChat();
  return chat;
}

describe('openen', () => {
  test('met een sleutel: het gesprek en het invoerveld, met de modellen om uit te kiezen', async () => {
    const chat = await setup();
    await chat.openChat();
    expect(dialog()).toHaveAttribute('open');
    expect(document.getElementById('chat-setup')!.hidden).toBe(true);
    expect(document.getElementById('chat-form')!.hidden).toBe(false);
    const model = document.getElementById('chat-model') as HTMLSelectElement;
    expect([...model.options].map((o) => o.value)).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5']);
    expect(model.value).toBe('claude-opus-5-5');
    expect(input()).toHaveFocus();
  });

  test('zonder sleutel: eerst uitleg en een veld voor de sleutel', async () => {
    agenda.chatStatus.mockResolvedValue({ hasKey: false, model: 'claude-opus-5-5', models: [] });
    const chat = await setup();
    await chat.openChat();
    expect(document.getElementById('chat-setup')!.hidden).toBe(false);
    expect(document.getElementById('chat-form')!.hidden).toBe(true);
    expect(document.getElementById('chat-forget')!.hidden).toBe(true);
    expect(screen.getByText(/apart van een Claude-abonnement/)).toBeInTheDocument();
    expect(document.getElementById('chat-key')).toHaveFocus();
    expect((document.getElementById('chat-key') as HTMLInputElement).type).toBe('password');
  });

  test('de knop bovenin opent en sluit; Escape sluit ook', async () => {
    await setup();
    fireEvent.click(document.getElementById('chat-open')!);
    await flush();
    expect(dialog()).toHaveAttribute('open');
    fireEvent.click(document.getElementById('chat-open')!);
    expect(dialog()).not.toHaveAttribute('open');
    fireEvent.click(document.getElementById('chat-open')!);
    await flush();
    fireEvent.keyDown(dialog(), { key: 'Escape' });
    expect(dialog()).not.toHaveAttribute('open');
  });
});

describe('sleutel invoeren', () => {
  const noKey = { hasKey: false, model: 'claude-opus-5-5', models: [] };
  const withKey = { hasKey: true, model: 'claude-opus-5-5', models: [{ id: 'claude-opus-5-5', label: 'Opus' }] };

  test('bewaren stuurt de sleutel naar main, wist het veld en toont het gesprek', async () => {
    agenda.chatStatus.mockResolvedValue(noKey);
    agenda.chatSetKey.mockResolvedValue(withKey);
    const chat = await setup();
    await chat.openChat();
    const key = document.getElementById('chat-key') as HTMLInputElement;
    key.value = 'sk-ant-api03-voorbeeld';
    fireEvent.click(document.getElementById('chat-save')!);
    await flush();
    expect(agenda.chatSetKey).toHaveBeenCalledWith('sk-ant-api03-voorbeeld');
    expect(key.value).toBe('');
    expect(document.getElementById('chat-form')!.hidden).toBe(false);
  });

  test('Enter in het sleutelveld bewaart ook; een afgewezen sleutel toont de reden', async () => {
    agenda.chatStatus.mockResolvedValue(noKey);
    agenda.chatSetKey.mockRejectedValue(
      new Error(
        "Error invoking remote method 'chat:set-key': Error: Dit lijkt geen API-sleutel van Anthropic (die begint met sk-ant-).",
      ),
    );
    const chat = await setup();
    await chat.openChat();
    const key = document.getElementById('chat-key') as HTMLInputElement;
    key.value = 'fout';
    fireEvent.keyDown(key, { key: 'Enter' });
    await flush();
    expect(document.getElementById('chat-setup-status')!.textContent).toBe(
      'Dit lijkt geen API-sleutel van Anthropic (die begint met sk-ant-).',
    );
    expect(document.getElementById('chat-setup')!.hidden).toBe(false);
    expect((document.getElementById('chat-save') as HTMLButtonElement).disabled).toBe(false);
  });

  test('"Sleutel verwijderen" toont weer het invoerveld en wist het gesprek', async () => {
    agenda.chatClearKey.mockResolvedValue(noKey);
    const chat = await setup();
    await chat.openChat();
    await chat.sendMessage('hoi');
    expect(log().children.length).toBeGreaterThan(0);
    fireEvent.click(document.getElementById('chat-forget')!);
    await flush();
    expect(log().children).toHaveLength(0);
    expect(document.getElementById('chat-setup')!.hidden).toBe(false);
  });
});

describe('praten', () => {
  test('een bericht: jouw bubbel, dan het antwoord met wat Claude heeft gedaan', async () => {
    agenda.chatSend.mockResolvedValue({
      text: 'Ik heb het ingepland.',
      actions: [
        { tool: 'find_free_time', label: 'Vrije tijd gezocht', ok: true },
        { tool: 'create_events', label: 'Afspraken gemaakt', ok: true },
      ],
    });
    const chat = await setup();
    await chat.openChat();
    input().value = 'Plan sporten';
    fireEvent.submit(document.getElementById('chat-form')!);
    await flush();
    expect(agenda.chatSend).toHaveBeenCalledWith('Plan sporten');
    const bubbles = [...log().children].map((c) => (c as HTMLElement).dataset.who);
    expect(bubbles).toEqual(['user', 'claude']);
    expect(log()).toHaveTextContent('Plan sporten');
    expect(log()).toHaveTextContent('Ik heb het ingepland.');
    expect(log()).toHaveTextContent('✓ Vrije tijd gezocht');
    expect(log()).toHaveTextContent('✓ Afspraken gemaakt');
    expect(input().value).toBe('');
    expect(log().getAttribute('aria-busy')).toBe('false');
  });

  test('tijdens het wachten staat er "Claude denkt na…" en kan je niet nog een bericht sturen', async () => {
    let release: (v: unknown) => void = () => {};
    agenda.chatSend.mockReturnValue(new Promise((resolve) => (release = resolve)));
    const chat = await setup();
    await chat.openChat();
    const sending = chat.sendMessage('vraag');
    await flush();
    expect(log()).toHaveTextContent('Claude denkt na…');
    expect(log().getAttribute('aria-busy')).toBe('true');
    expect(input().disabled).toBe(true);
    expect((document.getElementById('chat-send') as HTMLButtonElement).disabled).toBe(true);
    await chat.sendMessage('tweede'); // wordt genegeerd
    expect(agenda.chatSend).toHaveBeenCalledTimes(1);
    release({ text: 'klaar', actions: [] });
    await sending;
    expect(log()).not.toHaveTextContent('denkt na');
    expect(input().disabled).toBe(false);
  });

  test('Enter verstuurt, Shift+Enter niet; een leeg bericht niet', async () => {
    const chat = await setup();
    await chat.openChat();
    input().value = 'met shift';
    fireEvent.keyDown(input(), { key: 'Enter', shiftKey: true });
    await flush();
    expect(agenda.chatSend).not.toHaveBeenCalled();
    fireEvent.keyDown(input(), { key: 'Enter' });
    await flush();
    expect(agenda.chatSend).toHaveBeenCalledWith('met shift');
    input().value = '   ';
    fireEvent.keyDown(input(), { key: 'Enter' });
    await flush();
    expect(agenda.chatSend).toHaveBeenCalledTimes(1);
  });

  test('een fout wordt een rode melding in het gesprek, en de rest blijft werken', async () => {
    agenda.chatSend.mockRejectedValue(
      new Error(
        "Error invoking remote method 'chat:send': Error: Geen verbinding met Anthropic. Controleer je internetverbinding.",
      ),
    );
    const chat = await setup();
    await chat.openChat();
    await chat.sendMessage('hoi');
    const alert = within(log()).getByRole('alert');
    expect(alert).toHaveTextContent('Geen verbinding met Anthropic. Controleer je internetverbinding.');
    expect(log()).not.toHaveTextContent('denkt na');
    expect(input().disabled).toBe(false);
  });

  test('een afgewezen sleutel brengt je terug naar het sleutelveld', async () => {
    agenda.chatSend.mockRejectedValue(new Error('De API-sleutel is niet geaccepteerd. Controleer of hij klopt.'));
    const chat = await setup();
    await chat.openChat();
    agenda.chatStatus.mockResolvedValue({ hasKey: true, model: 'claude-opus-5-5', models: [] });
    await chat.sendMessage('hoi');
    expect(within(log()).getByRole('alert')).toHaveTextContent('API-sleutel is niet geaccepteerd');
  });

  test('een afgekapt antwoord en een mislukte tool worden getoond', async () => {
    agenda.chatSend.mockResolvedValue({
      text: 'half',
      actions: [{ tool: 'delete_event', label: 'Afspraak verwijderd', ok: false }],
      stopped: 'max_tokens',
    });
    const chat = await setup();
    await chat.openChat();
    await chat.sendMessage('x');
    expect(log()).toHaveTextContent('afgekapt');
    expect(log()).toHaveTextContent('✕ Afspraak verwijderd');
  });

  test('tekst van Claude wordt als tekst getoond, nooit als HTML', async () => {
    agenda.chatSend.mockResolvedValue({ text: '<img src=x onerror=alert(1)><b>vet</b>', actions: [] });
    const chat = await setup();
    await chat.openChat();
    await chat.sendMessage('x');
    expect(log().querySelector('img')).toBeNull();
    expect(log().querySelector('b')).toBeNull();
    expect(log()).toHaveTextContent('<b>vet</b>');
  });
});

describe('model en nieuw gesprek', () => {
  test('een ander model kiezen gaat naar main', async () => {
    agenda.chatSetModel.mockResolvedValue({
      hasKey: true,
      model: 'claude-sonnet-5-5',
      models: [
        { id: 'claude-opus-5-5', label: 'Opus' },
        { id: 'claude-sonnet-5-5', label: 'Sonnet' },
      ],
    });
    const chat = await setup();
    await chat.openChat();
    const select = document.getElementById('chat-model') as HTMLSelectElement;
    select.value = 'claude-sonnet-5-5';
    fireEvent.change(select);
    await flush();
    expect(agenda.chatSetModel).toHaveBeenCalledWith('claude-sonnet-5-5');
    expect(select.value).toBe('claude-sonnet-5-5');
  });

  test('"Nieuw gesprek" wist het scherm en het gesprek in main', async () => {
    const chat = await setup();
    await chat.openChat();
    await chat.sendMessage('hoi');
    expect(log().children.length).toBe(2);
    fireEvent.click(document.getElementById('chat-new')!);
    await flush();
    expect(agenda.chatReset).toHaveBeenCalled();
    expect(log().children).toHaveLength(0);
  });
});
