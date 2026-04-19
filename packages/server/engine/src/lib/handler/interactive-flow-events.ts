import { InteractiveFlowNodeStateEvent } from '@activepieces/shared'
import { EngineConstants } from './context/engine-constants'

async function emit({ constants, event }: {
    constants: EngineConstants
    event: Omit<InteractiveFlowNodeStateEvent, 'flowRunId' | 'timestamp'>
}): Promise<void> {
    const payload: InteractiveFlowNodeStateEvent = {
        ...event,
        flowRunId: constants.flowRunId,
        timestamp: new Date().toISOString(),
    }
    const url = `${constants.internalApiUrl}v1/engine/interactive-flow-events/`
    try {
        await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${constants.engineToken}`,
            },
            body: JSON.stringify(payload),
        })
    }
    catch {
        // WebSocket fan-out is best-effort; never fail the run because of it.
    }
}

export const interactiveFlowEvents = {
    emit,
}
