import { describe, expect, test } from 'vitest';
import { emailsOf, inviteDraft } from '../../../src/js/invite.ts';
import type { EventValues } from '../../../src/shared/types.ts';

const values = (over: Partial<EventValues> = {}): EventValues => ({
  title: 'Lunch',
  calendarId: 'home',
  location: 'Café De Hoek',
  url: '',
  notes: 'Neem je laptop mee',
  date: '2026-10-28',
  endDate: '2026-10-28',
  time: '12:00',
  endTime: '13:00',
  tz: '',
  repeat: null,
  alert: null,
  travel: 0,
  invitees: ['Sam', 'sam@example.com', ' lisa@example.nl ', 'sam@example.com'],
  task: false,
  ...over,
});

describe('emailsOf', () => {
  test('houdt alleen e-mailadressen, zonder spaties en dubbelen', () => {
    expect(emailsOf(values().invitees)).toEqual(['sam@example.com', 'lisa@example.nl']);
    expect(emailsOf(['Sam', 'Lisa'])).toEqual([]);
    expect(emailsOf([])).toEqual([]);
  });
});

describe('inviteDraft', () => {
  test('onderwerp, ontvangers en een leesbare tekst met wanneer en waar', () => {
    const draft = inviteDraft(values());
    expect(draft.to).toEqual(['sam@example.com', 'lisa@example.nl']);
    expect(draft.subject).toBe('Uitnodiging: Lunch');
    expect(draft.body).toContain('Hierbij nodig ik je uit voor: Lunch');
    expect(draft.body).toMatch(/Wanneer: woensdag 28 oktober 2026, 12:00–13:00/);
    expect(draft.body).toContain('Waar: Café De Hoek');
    expect(draft.body).toContain('Neem je laptop mee');
    expect(draft.body.endsWith('Groet')).toBe(true);
  });

  test('een hele dag en een meerdaagse afspraak', () => {
    expect(inviteDraft(values({ time: '', endTime: '' })).body).toContain('(hele dag)');
    const multi = inviteDraft(values({ time: '', endTime: '', endDate: '2026-10-30' })).body;
    expect(multi).toMatch(/woensdag 28 oktober 2026 t\/m vrijdag 30 oktober 2026/);
  });

  test('zonder locatie, link en notities verdwijnen die regels; een lege titel krijgt een standaard', () => {
    const draft = inviteDraft(values({ location: '', notes: '', title: '', url: '' }));
    expect(draft.body).not.toContain('Waar:');
    expect(draft.body).not.toContain('Link:');
    expect(draft.subject).toBe('Uitnodiging: afspraak');
    expect(inviteDraft(values({ url: 'https://meet.example/x' })).body).toContain('Link: https://meet.example/x');
  });
});
