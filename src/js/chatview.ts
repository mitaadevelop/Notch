// De assistent: een zijpaneel om met Claude over je agenda te praten, met je eigen API-sleutel
import type { ChatAction, ChatStatus, ChatTurn } from '../shared/types.ts';
import { errorMessage } from './sync.ts';
import { $, el } from './util.ts';

const f = {
  dialog: $<HTMLDialogElement>('chat-dialog'),
  open: $<HTMLButtonElement>('chat-open'),
  model: $<HTMLSelectElement>('chat-model'),
  setup: $('chat-setup'),
  key: $<HTMLInputElement>('chat-key'),
  save: $<HTMLButtonElement>('chat-save'),
  setupStatus: $('chat-setup-status'),
  log: $('chat-log'),
  form: $<HTMLFormElement>('chat-form'),
  input: $<HTMLTextAreaElement>('chat-input'),
  send: $<HTMLButtonElement>('chat-send'),
  note: $('chat-note'),
  forget: $<HTMLButtonElement>('chat-forget'),
};

let busy = false;

function showStatus(status: ChatStatus) {
  const ready = status.hasKey;
  f.setup.hidden = ready;
  f.log.hidden = !ready;
  f.form.hidden = !ready;
  f.model.hidden = !ready;
  f.forget.hidden = !ready;
  f.note.hidden = !ready;
  f.model.replaceChildren(...status.models.map((m) => new Option(m.label, m.id)));
  f.model.value = status.model;
}

function bubble(text: string, who: 'user' | 'claude' | 'error', actions: ChatAction[] = []) {
  const wrap = el('div', who === 'user' ? 'flex justify-end' : 'flex flex-col items-start gap-1');
  const tone = who === 'user' ? 'bg-accent text-white' : who === 'error' ? 'bg-today/15 text-today' : 'bg-fill text-fg';
  const body = el('div', `max-w-[92%] rounded-xl px-3 py-1.5 whitespace-pre-wrap ${tone}`, text);
  if (who === 'error') body.setAttribute('role', 'alert');
  wrap.dataset.who = who;
  if (actions.length) {
    const chips = el('div', 'flex max-w-[92%] flex-wrap gap-1');
    for (const action of actions) {
      chips.append(
        el(
          'span',
          `rounded-full px-2 py-0.5 text-[11px] ${action.ok ? 'bg-fill text-muted' : 'bg-today/15 text-today'}`,
          `${action.ok ? '✓' : '✕'} ${action.label}`,
        ),
      );
    }
    wrap.append(chips);
  }
  wrap.append(body);
  f.log.append(wrap);
  f.log.scrollTop = f.log.scrollHeight;
  return wrap;
}

function setBusy(on: boolean) {
  busy = on;
  f.send.disabled = on;
  f.input.disabled = on;
  f.log.setAttribute('aria-busy', String(on));
}

export async function sendMessage(text: string) {
  const message = text.trim();
  if (!message || busy) return;
  bubble(message, 'user');
  f.input.value = '';
  setBusy(true);
  const thinking = bubble('Claude denkt na…', 'claude');
  thinking.dataset.pending = '1';
  try {
    const turn: ChatTurn = await window.agenda.chatSend(message);
    thinking.remove();
    const suffix = turn.stopped === 'max_tokens' ? '\n\n(Het antwoord is afgekapt omdat het te lang werd.)' : '';
    bubble(turn.text + suffix, 'claude', turn.actions);
  } catch (error) {
    thinking.remove();
    bubble(errorMessage(error), 'error');
    // een ongeldige sleutel: meteen weer laten invoeren
    if (/API-sleutel/.test(errorMessage(error))) showStatus(await window.agenda.chatStatus());
  } finally {
    setBusy(false);
    f.input.focus();
  }
}

export async function openChat() {
  if (!f.dialog.open) f.dialog.show(); // niet-modaal: de agenda blijft bruikbaar
  try {
    showStatus(await window.agenda.chatStatus());
  } catch (error) {
    f.setupStatus.textContent = errorMessage(error);
  }
  (f.setup.hidden ? f.input : f.key).focus();
}

export function closeChat() {
  f.dialog.close();
}

export function initChat() {
  f.open.addEventListener('click', () => (f.dialog.open ? closeChat() : void openChat()));
  $('chat-close').addEventListener('click', closeChat);
  f.dialog.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeChat();
    }
  });

  f.form.addEventListener('submit', (e) => {
    e.preventDefault();
    void sendMessage(f.input.value);
  });
  // Enter verstuurt, Shift+Enter begint een nieuwe regel
  f.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      void sendMessage(f.input.value);
    }
  });

  f.save.addEventListener('click', async () => {
    f.save.disabled = true;
    f.setupStatus.textContent = '';
    try {
      showStatus(await window.agenda.chatSetKey(f.key.value));
      f.key.value = '';
      f.input.focus();
    } catch (error) {
      f.setupStatus.textContent = errorMessage(error);
    } finally {
      f.save.disabled = false;
    }
  });
  f.key.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      f.save.click();
    }
  });

  f.model.addEventListener('change', async () => {
    try {
      showStatus(await window.agenda.chatSetModel(f.model.value));
    } catch (error) {
      bubble(errorMessage(error), 'error');
    }
  });

  $('chat-new').addEventListener('click', async () => {
    await window.agenda.chatReset();
    f.log.replaceChildren();
    f.input.focus();
  });

  f.forget.addEventListener('click', async () => {
    showStatus(await window.agenda.chatClearKey());
    f.log.replaceChildren();
    f.key.focus();
  });
}
