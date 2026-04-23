/**
 * Conversation replay script for the estinzione domain.
 *
 * Mirrors the turns from estinzione-chat.local.spec.ts, adapted to the
 * generic ConversationStep API. Each message batches previously-established
 * fields because the AP chat trigger spins up a new flow run per message —
 * state does NOT persist across turns, the field-extractor must re-parse
 * the full set from every message.
 */

import type { ConversationStep } from '../../scenarios/ce/flows/copilot/conversation-harness';

// Each turn echoes ALL previously-established fields because the AP chat
// trigger creates a fresh flow run per message (state does not persist).
// The field extractor pulls everything from the single message. Messages
// are phrased to be clean for extraction (no flowery prose that might
// distract the extractor from the canonical field values).
//
// `expectBotPattern` is intentionally loose per turn — the authoritative
// gate is the final turn matching the caseId regex. Per-turn regex would
// couple the test to the exact wording the LLM chooses for each prompt,
// which is brittle across runs.
export const estinzioneConversationScript: ConversationStep[] = [
  {
    kind: 'text',
    user: 'cliente Bellafronte',
  },
  {
    kind: 'text',
    user: 'cliente Bellafronte NDG 11255521',
  },
  {
    kind: 'text',
    user:
      'cliente Bellafronte NDG 11255521 rapporto 01-034-00392400',
  },
  {
    kind: 'text',
    user:
      'cliente Bellafronte NDG 11255521 rapporto 01-034-00392400 motivazione 01 data 2029-04-15',
  },
  {
    kind: 'text',
    user:
      'cliente Bellafronte NDG 11255521 rapporto 01-034-00392400 motivazione 01 data 2029-04-15 sì confermo l\'invio della pratica',
    expectBotPattern: /ES-\d{4}-\d+|caseId|success|pratica|submit|complet|invi/i,
  },
];
