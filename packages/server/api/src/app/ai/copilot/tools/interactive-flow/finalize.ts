import { z } from 'zod'
import { CopilotContext, CopilotTool } from '../../scope-registry'

const Parameters = z.object({
    summary: z.string().min(1).describe('Short natural-language summary of what was built or changed.'),
    questions: z.array(z.string()).optional().describe('Optional follow-up questions to ask the user.'),
})

export const finalizeTool: CopilotTool = {
    description: 'Closes the copilot loop. Call this when the requested changes are applied and validated. The frontend will show this summary with an "Undo copilot only" button.',
    parameters: Parameters,
    isMutation: false,
    execute: async (rawArgs, _ctx: CopilotContext) => {
        const args = Parameters.parse(rawArgs)
        return {
            finalized: true,
            summary: args.summary,
            questions: args.questions ?? [],
        }
    },
}
