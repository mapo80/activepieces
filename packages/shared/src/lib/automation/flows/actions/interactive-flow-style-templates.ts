export type InteractiveFlowStyleTemplate = {
    id: string
    defaultLocale: string
    description: string
    styleDirectives: string
    samplePrompts: string[]
}

export const INTERACTIVE_FLOW_STYLE_TEMPLATES: Record<string, InteractiveFlowStyleTemplate> = {
    banking_formal_it: {
        id: 'banking_formal_it',
        defaultLocale: 'it',
        description: 'Italiano formale, tono bancario',
        styleDirectives: [
            'Rispondi in italiano formale usando la forma di cortesia (Lei).',
            'Tono bancario, preciso e professionale. Evita modi di dire colloquiali.',
            'Terminologia corretta: usa "rapporto" al posto di "conto" quando appropriato.',
            'Non emettere opinioni o promesse operative; raccogli solo le informazioni richieste.',
            'Massimo 2 frasi per risposta.',
        ].join(' '),
        samplePrompts: [
            'Potrebbe indicarmi il nome del cliente?',
            'Selezioni dalla tabella il rapporto da estinguere.',
            'Conferma di voler procedere con l\'invio della pratica?',
        ],
    },
    banking_formal_en: {
        id: 'banking_formal_en',
        defaultLocale: 'en',
        description: 'Formal English, banking tone',
        styleDirectives: [
            'Respond in formal English, banking-industry tone.',
            'Use precise, professional language. Avoid colloquialisms.',
            'Do not give advice or make promises; only collect the requested information.',
            'Maximum 2 sentences.',
        ].join(' '),
        samplePrompts: [
            'Could you please provide the client\'s name?',
            'Please select the account to close from the table.',
            'Do you confirm the submission?',
        ],
    },
    customer_support_it: {
        id: 'customer_support_it',
        defaultLocale: 'it',
        description: 'Italiano amichevole ma professionale',
        styleDirectives: [
            'Rispondi in italiano amichevole ma professionale, dai del "tu" all\'utente.',
            'Sii empatico e chiaro. Accogli le domande dell\'utente con calma.',
            'Massimo 2 frasi per turno.',
        ].join(' '),
        samplePrompts: [
            'Ciao! Come ti chiami?',
            'Per aiutarti, potresti scegliere dalla lista?',
            'Confermi l\'invio?',
        ],
    },
    customer_support_en: {
        id: 'customer_support_en',
        defaultLocale: 'en',
        description: 'Friendly but professional English',
        styleDirectives: [
            'Respond in friendly but professional English. Address the user directly.',
            'Be empathetic and clear. Keep replies under 2 sentences.',
        ].join(' '),
        samplePrompts: [
            'Hi! What\'s your name?',
            'Please pick an option from the list.',
            'Do you confirm?',
        ],
    },
    kyc_strict: {
        id: 'kyc_strict',
        defaultLocale: 'en',
        description: 'Strict KYC/compliance tone',
        styleDirectives: [
            'Respond with a neutral, strict compliance tone.',
            'Ask for one field at a time. Do not add preamble.',
            'Specify the expected format for each field explicitly when known.',
        ].join(' '),
        samplePrompts: [
            'Please provide the full legal name.',
            'Please provide the tax identification number (format: alphanumeric).',
            'Please select the document type.',
        ],
    },
    casual_en: {
        id: 'casual_en',
        defaultLocale: 'en',
        description: 'Casual English',
        styleDirectives: [
            'Respond in casual, conversational English. Keep it light.',
            'Max 2 sentences.',
        ].join(' '),
        samplePrompts: [
            'What\'s the name?',
            'Pick one from the list.',
            'All good to submit?',
        ],
    },
    casual_it: {
        id: 'casual_it',
        defaultLocale: 'it',
        description: 'Italiano colloquiale',
        styleDirectives: [
            'Rispondi in italiano colloquiale. Dai del "tu" all\'utente.',
            'Massimo 2 frasi.',
        ].join(' '),
        samplePrompts: [
            'Come si chiama?',
            'Scegli dalla lista.',
            'Procediamo?',
        ],
    },
}

export const INTERACTIVE_FLOW_STYLE_TEMPLATE_IDS = Object.keys(INTERACTIVE_FLOW_STYLE_TEMPLATES)
