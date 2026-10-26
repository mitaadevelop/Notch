// De chat in de app: praat met Claude via de API van de gebruiker en voert de agenda-tools uit die Claude aanroept.
// Het gesprek leeft hier (in main), met de volledige antwoorden van Claude (ook het denkwerk), zoals de API vraagt.
import type Anthropic from '@anthropic-ai/sdk';
import type { ChatAction, ChatTurn } from '../shared/types.ts';
import { modelById } from './models.ts';
import { INSTRUCTIONS } from '../mcp/tools.ts';
import type { ToolOutcome } from '../mcp/appserver.ts';

type Message = Anthropic.Beta.BetaMessage;
type Params = Anthropic.Beta.MessageCreateParamsNonStreaming;
export type CreateFn = (params: Params) => Promise<Message>;

const MAX_STEPS = 10; // hoeveel keer Claude achter elkaar tools mag gebruiken voor één vraag
const MAX_MESSAGES = 80; // daarna is het gesprek te lang en begint de gebruiker opnieuw
const MAX_RESULT_CHARS = 60_000;
const MAX_INPUT_CHARS = 8_000;

export const TOOL_LABELS: Record<string, string> = {
  get_context: 'Agenda bekeken',
  list_events: 'Afspraken opgevraagd',
  search_events: 'Gezocht in de agenda',
  get_event: 'Afspraak bekeken',
  find_free_time: 'Vrije tijd gezocht',
  create_events: 'Afspraken gemaakt',
  update_event: 'Afspraak gewijzigd',
  delete_event: 'Afspraak verwijderd',
};

export const systemPrompt = (now: Date) =>
  `${INSTRUCTIONS}

You are the assistant built into the Agenda app and you talk to the user in a chat panel next to their calendar.
- Answer in the language the user writes in (Dutch by default). Keep answers short and concrete; no long introductions.
- It is ${now.toLocaleString('nl-NL', { dateStyle: 'full', timeStyle: 'short' })} for the user right now.
- After you changed something, say briefly what you did. The user sees every change in the calendar and can undo it.`;

export interface ChatDeps {
  create: CreateFn;
  model: () => Promise<string>;
  tools: Anthropic.Beta.BetaTool[];
  run: (tool: string, args: unknown) => Promise<ToolOutcome>;
  now?: () => Date;
}

// vertaalt fouten van de API naar iets wat de gebruiker kan begrijpen en oplossen
export function describeError(error: unknown, sdk: typeof Anthropic): string {
  if (error instanceof sdk.AuthenticationError || error instanceof sdk.PermissionDeniedError) {
    return 'De API-sleutel is niet geaccepteerd. Controleer of hij klopt en of er tegoed op het account staat.';
  }
  if (error instanceof sdk.RateLimitError)
    return 'Anthropic meldt te veel verzoeken of een limiet die is bereikt. Probeer het zo opnieuw.';
  if (error instanceof sdk.APIConnectionError)
    return 'Geen verbinding met Anthropic. Controleer je internetverbinding.';
  if (error instanceof sdk.BadRequestError) return `Anthropic wees het verzoek af: ${error.message}`;
  if (error instanceof sdk.APIError)
    return `Anthropic gaf een fout (${error.status ?? 'onbekend'}). Probeer het later opnieuw.`;
  return error instanceof Error ? error.message : String(error);
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}\n… (ingekort)` : text);

export function createChat(deps: ChatDeps) {
  let messages: Anthropic.Beta.BetaMessageParam[] = [];
  let busy = false;

  return {
    reset() {
      messages = [];
    },

    get length() {
      return messages.length;
    },

    get busy() {
      return busy;
    },

    async send(raw: string): Promise<ChatTurn> {
      const text = typeof raw === 'string' ? raw.trim() : '';
      if (!text) throw new Error('Typ eerst een vraag.');
      if (text.length > MAX_INPUT_CHARS) throw new Error('Dit bericht is te lang.');
      if (busy) throw new Error('Claude is nog bezig met het vorige bericht.');
      if (messages.length >= MAX_MESSAGES)
        throw new Error('Dit gesprek is erg lang geworden. Begin een nieuw gesprek.');
      busy = true;
      // bij een fout halen we dit bericht en alles wat erna kwam weer weg, zodat het gesprek geldig blijft
      const checkpoint = messages.length;
      messages.push({ role: 'user', content: text });
      const actions: ChatAction[] = [];
      try {
        const model = await deps.model();
        for (let step = 0; step < MAX_STEPS; step++) {
          const response = await deps.create({
            model,
            max_tokens: 16000,
            system: systemPrompt((deps.now ?? (() => new Date()))()),
            tools: deps.tools,
            messages,
            // bij een weigering springt de server zelf in; niet elk model ondersteunt dat
            ...(modelById(model)?.fallback
              ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
              : {}),
          });
          // het volledige antwoord terug in het gesprek, ook het denkwerk: de API eist dat
          messages.push({ role: 'assistant', content: response.content as Anthropic.Beta.BetaContentBlockParam[] });

          if (response.stop_reason === 'refusal') {
            return { text: 'Claude wilde hier niet op ingaan.', actions, stopped: 'refusal' };
          }
          if (response.stop_reason !== 'tool_use') {
            const answer = response.content
              .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
              .map((b) => b.text)
              .join('\n')
              .trim();
            return {
              text: answer || '(geen antwoord)',
              actions,
              ...(response.stop_reason === 'max_tokens' ? { stopped: 'max_tokens' as const } : {}),
            };
          }

          // alle tools van deze stap, in één bericht terug
          const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
          for (const block of response.content) {
            if (block.type !== 'tool_use') continue;
            const outcome = await deps.run(block.name, block.input);
            actions.push({ tool: block.name, label: TOOL_LABELS[block.name] ?? block.name, ok: outcome.ok });
            results.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: clip(outcome.ok ? JSON.stringify(outcome.result) : outcome.error, MAX_RESULT_CHARS),
              ...(outcome.ok ? {} : { is_error: true }),
            });
          }
          messages.push({ role: 'user', content: results });
        }
        return {
          text: 'Dit kostte te veel stappen; ik ben gestopt. Probeer het in kleinere stukken.',
          actions,
          stopped: 'steps',
        };
      } catch (error) {
        messages = messages.slice(0, checkpoint);
        throw error;
      } finally {
        busy = false;
      }
    },
  };
}

export type Chat = ReturnType<typeof createChat>;
