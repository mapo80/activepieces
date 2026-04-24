import { z } from 'zod'

export const InfoIntentSchema = z.object({
    id: z.string().min(1),
    description: z.string().min(1),
    requiredFields: z.array(z.string().min(1)),
    rendererKey: z.string().min(1),
    localeTemplates: z.record(z.string(), z.string()).optional(),
})

export type InfoIntent = z.infer<typeof InfoIntentSchema>
