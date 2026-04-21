import { z } from 'zod'
import { BlockSchema } from '../engine/bubble-payload'

const FileResponseInterfaceV1 = z.object({
    base64Url: z.string(),
    fileName: z.string(),
    extension: z.string().optional(),
})

const FileResponseInterfaceV2 = z.object({
    mimeType: z.string(),
    url: z.string(),
    fileName: z.string().optional(),
})

export const FileResponseInterface = z.union([FileResponseInterfaceV1, FileResponseInterfaceV2])

export type FileResponseInterface = z.infer<typeof FileResponseInterface>



export enum HumanInputFormResultTypes {
    FILE = 'file',
    MARKDOWN = 'markdown',
    BLOCKS_V1 = 'blocks-v1',
}

export function createKeyForFormInput(displayName: string) {
    const inputKey = displayName
        .toLowerCase()
        .replace(/\s+(\w)/g, (_, letter) => letter.toUpperCase())
        .replace(/^(.)/, letter => letter.toLowerCase())

    /**We do this because react form inputs must not contain quotes */
    return inputKey.replaceAll(/[\\"''\n\r\t]/g, '')
}


export const HumanInputFormResult = z.union([
    z.object({
        type: z.literal(HumanInputFormResultTypes.FILE),
        value: FileResponseInterface,
    }),
    z.object({
        type: z.literal(HumanInputFormResultTypes.MARKDOWN),
        value: z.string(),
        files: z.array(FileResponseInterface).optional(),
    }),
    z.object({
        type: z.literal(HumanInputFormResultTypes.BLOCKS_V1),
        blocks: z.array(BlockSchema).min(1),
    }),
])

export type HumanInputFormResult = z.infer<typeof HumanInputFormResult>


export const ChatFormResponse = z.object({
    sessionId: z.string(),
    message: z.string(),
    files: z.array(z.string()).optional(),
})

export type ChatFormResponse = z.infer<typeof ChatFormResponse>
