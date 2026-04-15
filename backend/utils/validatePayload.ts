import type { ZodTypeAny, infer as ZodInfer } from 'zod'

export function validatePayload<TSchema extends ZodTypeAny>(
  schema: TSchema,
  payload: unknown,
): ZodInfer<TSchema> {
  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0]
    throw new Error(firstIssue?.message || 'Invalid payload')
  }
  return parsed.data
}
