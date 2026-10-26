// Een uitnodiging voor een afspraak opstellen: wie, onderwerp en tekst
import type { EventValues, MailDraft } from '../shared/types.ts';
import { dayHeadingYear, fromKey } from './util.ts';

const EMAIL = /^[^\s@<>(),;:"[\]\\]+@[^\s@<>(),;:"[\]\\]+\.[^\s@<>(),;:"[\]\\]{2,}$/;

/** Genodigden die een e-mailadres zijn (de rest zijn alleen namen). */
export const emailsOf = (invitees: string[]) => [
  ...new Set(invitees.map((i) => i.trim()).filter((i) => EMAIL.test(i))),
];

export function inviteDraft(values: EventValues): MailDraft {
  const day = (key: string) => dayHeadingYear.format(fromKey(key));
  const when =
    values.endDate > values.date
      ? `${day(values.date)}${values.time ? ` ${values.time}` : ''} t/m ${day(values.endDate)}${values.endTime ? ` ${values.endTime}` : ''}`
      : `${day(values.date)}${values.time ? `, ${values.time}${values.endTime ? `–${values.endTime}` : ''}` : ' (hele dag)'}`;
  const lines = [
    'Hoi,',
    '',
    `Hierbij nodig ik je uit voor: ${values.title || 'een afspraak'}`,
    `Wanneer: ${when}`,
    ...(values.location ? [`Waar: ${values.location}`] : []),
    ...(values.url ? [`Link: ${values.url}`] : []),
    ...(values.notes ? ['', values.notes] : []),
    '',
    'Groet',
  ];
  return {
    to: emailsOf(values.invitees),
    subject: `Uitnodiging: ${values.title || 'afspraak'}`,
    body: lines.join('\n'),
  };
}
