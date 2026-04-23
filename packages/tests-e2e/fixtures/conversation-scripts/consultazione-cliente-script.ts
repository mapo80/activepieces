/**
 * Conversation replay script for the consultazione-cliente domain.
 *
 * This is a read-only flow (no core-banking submit): the operator queries
 * a customer's position, receives profile + accounts list, the bot builds
 * a PDF report, operator confirms they shared it with the customer.
 *
 * The flow is expected to use the same MCP tool surface as estinzione
 * (search_customer, get_profile, list_accounts, generate_module) but in a
 * different layout — no closure reasons, no effective date, no
 * submit_closure. Demonstrates the Copilot composes from the *brief*, not
 * from a hardcoded recipe.
 */

import type { ConversationStep } from '../../scenarios/ce/flows/copilot/conversation-harness';

export const consultazioneClienteConversationScript: ConversationStep[] = [
  {
    kind: 'text',
    user: 'Vorrei consultare la posizione del cliente Bellafronte',
    expectBotPattern: /bellafronte|cliente|seleziona/i,
  },
  {
    kind: 'text',
    user: 'Prendo il cliente Bellafronte con NDG 11255521',
    expectBotPattern: /profilo|rapport|posizione|report/i,
  },
  {
    kind: 'text',
    user:
      'Sì, confermo di aver condiviso il report col cliente Bellafronte NDG 11255521',
    expectBotPattern: /condiv|confer|chiuso|completat|ok|grazie/i,
  },
];
