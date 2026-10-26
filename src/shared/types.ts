// gedeelde types: datamodel, voorkomens en de API die preload.ts aan de pagina geeft
export type ColorName = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'brown' | 'gray';
export type CalendarType = 'user' | 'birthdays' | 'holidays';
export type RepeatFreq = 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly';
export type Scope = 'only' | 'following' | 'all';
export type View = 'day' | 'week' | 'month' | 'year' | 'list';

// waar een agenda vandaan komt als hij niet lokaal is: alleen-lezen en wordt ververst
export type CalendarSource =
  | { kind: 'feed'; url: string; provider: 'google' | 'outlook' | 'icloud' | 'other' }
  | { kind: 'caldav'; accountId: string; calendarUrl: string; provider: 'icloud' | 'caldav' };

export interface Calendar {
  id: string;
  name: string;
  color: ColorName;
  visible: boolean;
  type: CalendarType;
  source?: CalendarSource;
  syncedAt?: number; // ms sinds 1970 van de laatste geslaagde synchronisatie
  syncError?: string; // melding van de laatste mislukte synchronisatie
}

export interface Repeat {
  freq: RepeatFreq;
  interval: number;
  until: string;
  byDay?: number[]; // alleen bij 'weekly': weekdagen (0 = zondag … 6 = zaterdag)
}

export interface CalEvent {
  id: string;
  calendarId: string;
  title: string;
  date: string;
  endDate: string;
  time: string;
  endTime: string;
  location: string;
  url: string;
  notes: string;
  repeat: Repeat | null;
  alert: number | null;
  travel: number;
  invitees: string[];
  tz: string;
  exceptions: string[];
  task: boolean; // een to-do: heeft een vinkje in plaats van een tijdsduur
  doneOn: string[]; // van een taak: de (oorspronkelijke) data waarop hij is afgevinkt
}

// wat de bewerkdialoog en verplaats-acties doorgeven: alles behalve id en uitzonderingen
export type EventValues = Omit<CalEvent, 'id' | 'exceptions' | 'doneOn'>;

// een afspraak die je vaak maakt, met alles behalve de datum
export interface EventTemplate {
  id: string;
  name: string;
  title: string;
  calendarId: string;
  location: string;
  notes: string;
  invitees: string[];
  time: string; // leeg = hele dag
  duration: number; // minuten, 0 bij een hele dag
  alert: number | null;
  travel: number;
  repeat: Repeat | null;
}

export interface Settings {
  weekStart: number; // 0 = zondag, 1 = maandag, 6 = zaterdag
  clock24: boolean;
  weekNumbers: boolean;
  defaultAlert: number | null;
  refreshMinutes: number; // elke zoveel minuten externe agenda's vernieuwen; 0 = niet automatisch
  templates: EventTemplate[];
  tray: boolean; // volgende afspraak in de menubalk
  weather: GeoPlace | null; // plaats voor het weer per dag (null = uit)
  clocks: string[]; // extra tijdzones naast het uurraster (hooguit 2), bijv. ["America/New_York"]
  shortcut: string; // globale sneltoets voor een nieuwe afspraak ('' = uit), bijv. "CommandOrControl+Alt+N"
}

export interface AgendaData {
  version: number;
  calendars: Calendar[];
  events: CalEvent[];
  settings: Settings;
}

// losse invoer (oud opslagformaat, ics, dialoog) voordat die genormaliseerd is
export type EventInput = Partial<Omit<CalEvent, 'repeat'>> & {
  date: string;
  repeat?: Partial<Repeat> | null;
  color?: string; // alleen in het oude formaat
};

export type CalendarInput = Partial<Calendar>;

export interface Slot {
  date: string;
  endDate: string;
  time: string;
  endTime: string;
}

interface OccBase extends Slot {
  key: string;
  calendarId: string;
  title: string;
  location: string;
  allDay: boolean;
  baseDate: string;
  base: Slot;
}

export interface EventOcc extends OccBase {
  id: string;
  ev: CalEvent;
  recurring: boolean;
  holiday: false;
}

export interface HolidayOcc extends OccBase {
  id: null;
  ev: null;
  recurring: false;
  holiday: true;
}

export type Occurrence = EventOcc | HolidayOcc;

export interface Holiday {
  date: string;
  title: string;
}

export interface SearchResult {
  ev: CalEvent | null;
  title?: string;
  date: string;
  calendar: Calendar;
}

export interface Quick {
  title: string;
  date: string;
  time: string;
  endTime: string;
  allDay: boolean;
  repeat: Repeat | null;
  location: string;
  calendarName: string;
  dateFound: boolean; // stond er echt een datum in de tekst (anders is het vandaag)
}

// --- IPC tussen pagina en main ---

export interface MenuItemSpec {
  id?: string;
  label?: string;
  enabled?: boolean;
  separator?: boolean;
}

export interface IcsFile {
  name: string;
  text: string;
}

export interface NotifyPayload {
  title: string;
  body: string;
  id: string | null;
  date: string;
}

export type NativeEditCommand = 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll';

// --- Claude (MCP) ---

// wat Claude via de MCP-server mag; staat in mcp.json naast events.json en geldt direct
export interface BackupInfo {
  name: string;
  at: number; // ms sinds 1970
  bytes: number;
  events: number;
  beforeRestore: boolean; // gemaakt vlak voor een eerder herstel
}

export interface TrayItem {
  label: string;
  date: string;
  id: string | null;
}

// wat de pagina aan main vertelt voor het menubalk-icoon
export interface TrayState {
  enabled: boolean;
  title: string; // tekst naast het icoon (macOS)
  tooltip: string;
  items: TrayItem[];
}

// de chat in de app
export interface ChatAction {
  tool: string;
  label: string;
  ok: boolean;
}

export interface ChatTurn {
  text: string;
  actions: ChatAction[];
  stopped?: 'refusal' | 'max_tokens' | 'steps';
}

export interface ChatStatus {
  hasKey: boolean;
  model: string;
  models: { id: string; label: string }[];
}

// een gevonden plaats (voor het weer)
export interface GeoPlace {
  city: string;
  lat: number;
  lon: number;
}

// het weer van één dag; code is een WMO-weercode
export interface DayWeather {
  date: string;
  code: number;
  max: number;
  min: number;
  rain: number; // kans op neerslag, %
}

// een e-mail die de mail-app van de gebruiker opent
export interface MailDraft {
  to: string[];
  subject: string;
  body: string;
}

export interface McpConfig {
  allowWrite: boolean; // afspraken maken, wijzigen en verwijderen
  shareNotes: boolean; // notities van afspraken tonen
  shareInvitees: boolean; // genodigden tonen
}

export interface McpStatus {
  config: McpConfig;
  // hoe Claude Desktop of Claude Code de server start
  command: string;
  args: string[];
  env: Record<string, string>;
  claudeDesktopConfig: string; // pad van claude_desktop_config.json
  running: boolean;
}

export interface McpCall {
  id: number;
  tool: string;
  args: unknown;
}

// --- updates ---

export type UpdateStatus =
  'unsupported' | 'idle' | 'checking' | 'available' | 'none' | 'downloading' | 'ready' | 'error';

export interface UpdateState {
  status: UpdateStatus;
  currentVersion: string;
  version?: string; // de nieuwe versie (bij available, downloading en ready)
  progress?: number; // 0-100 tijdens het downloaden
  error?: string;
  checkedAt?: number; // ms sinds 1970 van de laatste geslaagde controle
}

// --- externe agenda's ---

export interface AccountRequest {
  provider: 'icloud' | 'caldav';
  serverUrl: string;
  username: string;
  password: string;
}

export interface RemoteCalendar {
  url: string;
  name: string;
  color: string;
}

export interface AccountResult {
  accountId: string;
  calendars: RemoteCalendar[];
}

export interface AgendaApi {
  platform: string;
  load(): Promise<unknown>;
  save(data: AgendaData): Promise<void>;
  exportICS(text: string, name: string): Promise<boolean>;
  importICS(): Promise<IcsFile[]>;
  notify(payload: NotifyPayload): void;
  onNotificationSnooze(callback: (payload: NotifyPayload, minutes: number) => void): void;
  setDockIcon(dataUrl: string): void;
  nativeEdit(command: NativeEditCommand): void;
  menuState(state: { weekNumbers: boolean }): void;
  popupMenu(items: MenuItemSpec[]): Promise<string | null>;
  fetchFeed(url: string): Promise<string>;
  connectAccount(request: AccountRequest): Promise<AccountResult>;
  fetchAccountCalendar(accountId: string, calendarUrl: string): Promise<string>;
  removeAccount(accountId: string): Promise<void>;
  composeMail(draft: MailDraft): Promise<boolean>;
  chatStatus(): Promise<ChatStatus>;
  chatSetKey(key: string): Promise<ChatStatus>;
  chatClearKey(): Promise<ChatStatus>;
  chatSetModel(id: string): Promise<ChatStatus>;
  chatSend(text: string): Promise<ChatTurn>;
  chatReset(): Promise<void>;
  geocode(name: string): Promise<GeoPlace>;
  getForecast(lat: number, lon: number): Promise<DayWeather[]>;
  updateTray(state: TrayState): void;
  setShortcut(accelerator: string): Promise<boolean>;
  listBackups(): Promise<BackupInfo[]>;
  restoreBackup(name: string): Promise<boolean>;
  getMcp(): Promise<McpStatus>;
  setMcp(config: Partial<McpConfig>): Promise<McpStatus>;
  installMcpForClaude(): Promise<{ installed: boolean; path: string }>;
  onMcpCall(callback: (call: McpCall) => void): void;
  mcpReply(id: number, reply: { ok: true; result: unknown } | { ok: false; error: string }): void;
  mcpReady(): void;
  getUpdateState(): Promise<UpdateState>;
  checkForUpdates(): Promise<void>;
  downloadUpdate(): Promise<void>;
  installUpdate(): Promise<void>;
  onUpdateState(callback: (state: UpdateState) => void): void;
  onMenu(callback: (name: string) => void): void;
  onNotificationOpen(callback: (payload: { id: string | null; date: string }) => void): void;
}
