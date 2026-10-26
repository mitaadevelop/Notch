// De modellen waaruit de gebruiker kan kiezen voor de chat in de app
export interface ChatModel {
  id: string;
  label: string;
  /** ondersteunt de server de automatische terugval bij een weigering? */
  fallback: boolean;
}

export const CHAT_MODELS: ChatModel[] = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (krachtigst)', fallback: true },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (sneller en voordeliger)', fallback: true },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (snelst, het voordeligst)', fallback: false },
];

export const DEFAULT_CHAT_MODEL = CHAT_MODELS[0].id;
export const modelById = (id: unknown) => CHAT_MODELS.find((m) => m.id === id);
