// Een uitnodiging per e-mail klaarzetten: de mail-app van de gebruiker opent met ontvangers, onderwerp en tekst ingevuld.
// Alleen het hoofdproces maakt de mailto-link, zodat de pagina nooit willekeurige adressen kan openen.
import type { MailDraft } from './shared/types.ts';

const EMAIL = /^[^\s@<>(),;:"[\]\\]+@[^\s@<>(),;:"[\]\\]+\.[^\s@<>(),;:"[\]\\]{2,}$/;
const MAX_URL = 1800; // langer wordt door veel mailprogramma's en besturingssystemen afgekapt

export const isEmail = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 254 && EMAIL.test(value);

/** De mailto-link voor een concept, of null als er geen geldige ontvanger is. */
export function mailtoUrl(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const draft = raw as Partial<MailDraft>;
  const to = Array.isArray(draft.to) ? [...new Set(draft.to.filter(isEmail))].slice(0, 50) : [];
  if (!to.length) return null;
  const subject = typeof draft.subject === 'string' ? draft.subject.slice(0, 200) : '';
  let body = typeof draft.body === 'string' ? draft.body.slice(0, 5000) : '';
  const build = () =>
    `mailto:${to.map(encodeURIComponent).join(',')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  let url = build();
  // een te lange tekst inkorten in plaats van de hele mail te laten mislukken
  while (url.length > MAX_URL && body.length > 0) {
    body = body.slice(0, Math.max(0, body.length - Math.ceil((url.length - MAX_URL) / 3) - 1));
    url = build();
  }
  return url.length <= MAX_URL ? url : null;
}
