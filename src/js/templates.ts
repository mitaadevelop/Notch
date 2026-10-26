// Sjablonen: een afspraak die je vaak maakt (naam, tijd, duur, agenda, ...) met één opdracht opnieuw maken
import type { EventTemplate, EventValues } from '../shared/types.ts';
import type { NewEventOptions } from './state.ts';
import { fromMinutes, toMinutes } from './util.ts';

// Maakt van de ingevulde afspraak een sjabloon. De duur wordt de lengte op één dag (meerdaags telt als een uur).
export function templateFromValues(values: EventValues, name: string, id: string): EventTemplate {
  const sameDay = values.date === values.endDate;
  const length = values.time && values.endTime && sameDay ? toMinutes(values.endTime) - toMinutes(values.time) : 60;
  return {
    id,
    name: name.trim() || values.title,
    title: values.title,
    calendarId: values.calendarId,
    location: values.location,
    notes: values.notes,
    invitees: [...values.invitees],
    time: values.time,
    duration: values.time ? Math.min(Math.max(length, 5), 1439) : 0,
    alert: values.alert,
    travel: values.travel,
    repeat: values.repeat ? { ...values.repeat } : null,
  };
}

// De opties om de afspraakdialoog met een sjabloon te vullen op `date`.
export function optionsFromTemplate(template: EventTemplate, date: string): NewEventOptions {
  const endTime = template.time ? fromMinutes(Math.min(toMinutes(template.time) + template.duration, 24 * 60 - 1)) : '';
  return {
    prefill: {
      title: template.title,
      calendarId: template.calendarId,
      location: template.location,
      notes: template.notes,
      invitees: [...template.invitees],
      date,
      endDate: date,
      time: template.time,
      endTime,
      alert: template.alert,
      travel: template.travel,
      repeat: template.repeat ? { ...template.repeat } : null,
    },
  };
}
