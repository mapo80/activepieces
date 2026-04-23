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

export const estinzioneConversationScript: ConversationStep[] = [
  {
    kind: 'text',
    user: 'Vorrei estinguere un rapporto di Bellafronte',
    expectBotPattern: /bellafronte/i,
  },
  {
    kind: 'text',
    user: 'confermo il cliente Bellafronte con NDG 11255521',
    expectBotPattern: /11255521|rapport|account/i,
  },
  {
    kind: 'text',
    user: 'per il cliente NDG 11255521 scelgo il rapporto 01-034-00392400',
    expectBotPattern: /motivazion|trasferimento|data|reason|effective|closure/i,
  },
  {
    kind: 'text',
    user:
      'per NDG 11255521 rapporto 01-034-00392400: motivazione 01 trasferimento estero, data efficacia 2029-04-15',
    expectBotPattern: /confer|estinzion|modulo|pdf|confirm|submission/i,
  },
  {
    kind: 'text',
    user:
      'per cliente Bellafronte NDG 11255521 rapporto 01-034-00392400 motivazione 01 data 2029-04-15: sì, confermo l\'invio della pratica',
    expectBotPattern: /ES-\d{4}-\d+|invi|success|pratica|submit|complet/i,
  },
];
