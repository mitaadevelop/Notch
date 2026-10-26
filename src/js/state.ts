// gedeelde toestand: de data, de gekozen weergave en haken waarmee modules elkaar aanroepen
import type { Calendar, CalEvent, EventOcc, EventValues, Occurrence, SearchResult, View } from '../shared/types.ts';
import { migrate } from './model.ts';
import { todayKey } from './util.ts';
import { COLORS } from './colors.ts';

export const data = migrate(null);

interface Ui {
  view: View;
  selectedDate: string;
  miniKey: string;
  selectedKey: string | null; // key van het geselecteerde afspraak-voorkomen
  selectedOcc: Occurrence | null; // laatst aangeklikte afspraak
  selected: Map<string, Occurrence>; // alle geselecteerde afspraken (⇧/⌘-klik), op sleutel
  query: string;
  clipboard: CalEvent[]; // één of meer gekopieerde afspraken
  // zolang er gesleept of getypt wordt, wacht opnieuw tekenen (anders raken de elementen los van de actie)
  holds: number;
  syncing: Set<string>; // agenda's die nu worden ververst
  renderDeferred: boolean;
}

export const ui: Ui = {
  view: 'month',
  selectedDate: todayKey(),
  miniKey: todayKey(),
  selectedKey: null,
  selectedOcc: null,
  selected: new Map(),
  query: '',
  clipboard: [],
  holds: 0,
  syncing: new Set(),
  renderDeferred: false,
};

// alle afspraken die in de huidige weergave getekend zijn, op sleutel (voor "alles selecteren" en pijltjesbesturing)
export const occRegistry = new Map<string, Occurrence>();

export function clearSelection() {
  ui.selectedKey = null;
  ui.selectedOcc = null;
  ui.selected.clear();
}

// de geselecteerde afspraken zonder feestdagen; één aangeklikte afspraak telt ook als selectie
export function selectedEvents(): EventOcc[] {
  const all = ui.selected.size ? [...ui.selected.values()] : ui.selectedOcc ? [ui.selectedOcc] : [];
  return all.filter((o): o is EventOcc => !o.holiday);
}

// Houdt het opnieuw tekenen vast tot de bijbehorende releaseRender(); een uitgestelde tekenronde volgt daarna.
export function holdRender() {
  ui.holds++;
}

export function releaseRender() {
  ui.holds = Math.max(0, ui.holds - 1);
  if (ui.holds === 0 && ui.renderDeferred) {
    ui.renderDeferred = false;
    hooks.render();
  }
}

// opties voor een nieuwe afspraak; prefill komt uit snel invoeren
export interface NewEventOptions {
  date?: string;
  endDate?: string;
  time?: string;
  endTime?: string;
  allDay?: boolean;
  prefill?: Partial<EventValues>;
}

// verplaatsing van een voorkomen: dagen en minuten, of een nieuw tijdvak (vergroten)
export interface Move {
  days?: number;
  startMinutes?: number;
  endMinutes?: number;
  toTimed?: { time: string; endTime: string };
  // kopiëren in plaats van verplaatsen (Alt/Option ingedrukt bij het loslaten)
  copy?: boolean;
}

interface Hooks {
  render(): void;
  selectDate(key: string): void;
  setView(view: View, key?: string): void;
  selectOcc(occ: Occurrence): void;
  toggleOcc(occ: Occurrence): void;
  // verplaatst een afspraak (of de hele selectie als hij daarbij hoort) naar een andere eigen agenda
  changeCalendar(occ: Occurrence, calendarId: string): void;
  // de balk van een meerdaagse afspraak langer of korter maken: `key` is de nieuwe eerste of laatste dag
  resizeOcc(occ: Occurrence, edge: 'start' | 'end', key: string): Promise<void>;
  openOcc(occ: Occurrence): void;
  newEvent(opts?: NewEventOptions): void;
  openSearchResult(result: SearchResult): void;
  moveOcc(occ: Occurrence, move: Move): Promise<void>;
  toggleCalendar(calendar: Calendar): void;
  editCalendar(calendar: Calendar): void;
  occMenu(occ: Occurrence): Promise<void>;
  // toont een melding met "Ongedaan maken" na een wijziging van de gebruiker (optioneel: tests en kale omgevingen hebben hem niet)
  undoToast?(message: string): void;
  // tekent alleen de zijbalk opnieuw (bijv. een draaiend icoontje tijdens het verversen)
  refreshSidebar?(): void;
  // het vernieuwknopje bovenin draait zolang externe agenda's worden ververst
  syncState?(): void;
  occCommand(
    occ: Occurrence,
    command: 'edit' | 'duplicate' | 'copy' | 'delete' | 'calendar',
    arg?: string,
  ): Promise<void>;
  dayMenu(key: string, time?: string): Promise<void>;
  calendarMenu(calendar: Calendar): Promise<void>;
}

// door app.ts ingevuld voordat er iets wordt gerenderd
export const hooks = {} as Hooks;

export const calendarOf = (id: string) => data.calendars.find((c) => c.id === id) ?? data.calendars[0];
// agenda's met een bron (Google, iCloud, een link, …) zijn alleen-lezen: de volgende synchronisatie overschrijft wijzigingen
export const isReadOnly = (calendarId: string) => Boolean(data.calendars.find((c) => c.id === calendarId)?.source);
export const writableCalendars = () => data.calendars.filter((c) => c.type !== 'holidays' && !c.source);

export const colorOfOcc = (occ: Occurrence) => COLORS[calendarOf(occ.calendarId)?.color] ?? COLORS.blue;
