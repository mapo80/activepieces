import {
    ActivePiecesProviderAuthConfig,
    AIProviderName,
    AnthropicProviderAuthConfig,
    AzureProviderAuthConfig,
    AzureProviderConfig,
    isNil,
    OpenAICompatibleProviderAuthConfig,
    OpenAICompatibleProviderConfig,
    OpenAIProviderAuthConfig,
} from '@activepieces/shared'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createAzure } from '@ai-sdk/azure'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { LanguageModel } from 'ai'
import { FastifyBaseLogger } from 'fastify'
import { aiProviderService } from './ai-provider-service'

async function buildInteractiveFlowModel({ platformId, provider, modelId, log }: {
    platformId: string
    provider: AIProviderName
    modelId: string
    log: FastifyBaseLogger
}): Promise<LanguageModel> {
    const { auth, config } = await aiProviderService(log).getConfigOrThrow({ platformId, provider })
    switch (provider) {
        case AIProviderName.OPENAI: {
            const openai = createOpenAI({ apiKey: (auth as OpenAIProviderAuthConfig).apiKey })
            return openai.chat(modelId)
        }
        case AIProviderName.ANTHROPIC: {
            const anthropic = createAnthropic({ apiKey: (auth as AnthropicProviderAuthConfig).apiKey })
            return anthropic(modelId)
        }
        case AIProviderName.AZURE: {
            const azureConfig = config as AzureProviderConfig
            const azure = createAzure({
                apiKey: (auth as AzureProviderAuthConfig).apiKey,
                resourceName: azureConfig.resourceName,
            })
            return azure(modelId)
        }
        case AIProviderName.ACTIVEPIECES: {
            const apiKey = (auth as ActivePiecesProviderAuthConfig).apiKey
            const compat = createOpenAICompatible({
                name: 'activepieces',
                apiKey,
                baseURL: 'https://cloud.activepieces.com/api/v1/ai-providers/proxy/openai/v1',
            })
            return compat.chatModel(modelId)
        }
        case AIProviderName.CUSTOM: {
            const compatConfig = config as OpenAICompatibleProviderConfig
            const apiKey = (auth as OpenAICompatibleProviderAuthConfig).apiKey
            if (isNil(compatConfig?.baseUrl)) {
                throw new Error('Custom provider missing baseUrl')
            }
            const compat = createOpenAICompatible({
                name: 'custom',
                apiKey,
                baseURL: compatConfig.baseUrl,
                headers: compatConfig.defaultHeaders,
            })
            return compat.chatModel(modelId)
        }
        default:
            throw new Error(`Unsupported provider for interactive-flow: ${provider}`)
    }
}

export const interactiveFlowModelFactory = {
    build: buildInteractiveFlowModel,
}
