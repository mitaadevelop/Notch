import type { AgendaApi } from '../shared/types.ts';

declare global {
  interface Window {
    agenda: AgendaApi;
  }
}
