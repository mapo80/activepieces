import { PrincipalType } from '@activepieces/shared'
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { securityAccess } from '../../core/security/authorization/fastify-security'
import { platformPlanService } from '../../ee/platform/platform-plan/platform-plan.service'

const Body = z.object({ enabled: z.boolean() })

export const copilotDevToggleController: FastifyPluginAsyncZod = async (app) => {
    app.post(
        '/toggle-copilot',
        {
            schema: { body: Body },
            config: { security: securityAccess.platformAdminOnly([PrincipalType.USER]) },
        },
        async (req) => {
            const body = req.body as z.infer<typeof Body>
            const platformId = (req.principal as { platform: { id: string } }).platform.id
            await platformPlanService(req.log).getOrCreateForPlatform(platformId)
            const updated = await platformPlanService(req.log).update({ platformId, copilotEnabled: body.enabled })
            return { ok: true, enabled: body.enabled, copilotEnabled: updated.copilotEnabled, platformId }
        },
    )
}
