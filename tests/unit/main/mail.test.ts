import { describe, expect, test } from 'vitest';
import { isEmail, mailtoUrl } from '../../../src/mail.ts';

describe('isEmail', () => {
  test.each(['sam@example.com', 'a.b+c@sub.example.nl', 'x@y.io'])('geldig: %s', (v) => expect(isEmail(v)).toBe(true));
  test.each([
    'Sam',
    'sam@',
    '@example.com',
    'sam@example',
    'sam @example.com',
    'a@b@c.nl',
    '<x@y.nl>',
    'x@y.nl,z@y.nl',
    '',
    5,
    null,
    `${'a'.repeat(250)}@y.nl`,
  ])('ongeldig: %j', (v) => expect(isEmail(v)).toBe(false));
});

describe('mailtoUrl', () => {
  test('ontvangers, onderwerp en tekst worden netjes gecodeerd', () => {
    const url = mailtoUrl({
      to: ['sam@example.com', 'lisa@example.nl'],
      subject: 'Uitnodiging: Lunch & koffie',
      body: 'Hoi,\n\nTot dan?',
    })!;
    expect(url.startsWith('mailto:sam%40example.com,lisa%40example.nl?subject=')).toBe(true);
    expect(url).toContain('subject=Uitnodiging%3A%20Lunch%20%26%20koffie');
    expect(url).toContain('body=Hoi%2C%0A%0ATot%20dan%3F');
  });

  test('alleen geldige, unieke ontvangers; zonder geldige ontvanger geen link', () => {
    expect(mailtoUrl({ to: ['sam@example.com', 'sam@example.com', 'Sam', 'x'], subject: '', body: '' })).toContain(
      'mailto:sam%40example.com?',
    );
    expect(mailtoUrl({ to: ['Sam'], subject: 's', body: 'b' })).toBeNull();
    expect(mailtoUrl({ to: [], subject: 's', body: 'b' })).toBeNull();
  });

  test.each([null, undefined, 5, 'x', [], { to: 'sam@example.com' }, { to: null }])('onzin: %j', (raw) => {
    expect(mailtoUrl(raw)).toBeNull();
  });

  test('een ontvanger kan geen extra mailto-velden injecteren (cc, bcc)', () => {
    const url = mailtoUrl({ to: ['a@b.nl?cc=evil@x.nl', 'a@b.nl&bcc=evil@x.nl', 'ok@b.nl'], subject: '', body: '' })!;
    expect(url).not.toContain('cc=');
    expect(url).not.toContain('bcc=');
    expect(url.startsWith('mailto:ok%40b.nl?')).toBe(true);
  });

  test('een te lange tekst wordt ingekort zodat de link bruikbaar blijft', () => {
    const url = mailtoUrl({
      to: ['sam@example.com'],
      subject: 'Onderwerp',
      body: 'Lange tekst met speciale tekens & ë '.repeat(500),
    })!;
    expect(url.length).toBeLessThanOrEqual(1800);
    expect(url).toContain('body=Lange');
  });

  test('een extreem lang onderwerp of ontvangerslijst geeft nooit een kapotte link', () => {
    const many = Array.from({ length: 80 }, (_, i) => `gast${i}@example.com`);
    const url = mailtoUrl({ to: many, subject: 'x'.repeat(1000), body: 'tekst' });
    expect(url === null || url.length <= 1800).toBe(true);
  });
});
