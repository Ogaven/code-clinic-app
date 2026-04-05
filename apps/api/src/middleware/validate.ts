import { Request, Response, NextFunction } from 'express'
import { ZodSchema, ZodError } from 'zod'

export function validate(schema: ZodSchema, target: 'body' | 'query' | 'params' = 'body') {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[target])
    if (!result.success) {
      const errors = result.error.errors.map((e: ZodError['errors'][0]) => ({
        field: e.path.join('.'),
        message: e.message,
      }))
      res.status(400).json({ error: 'Validation failed', errors })
      return
    }
    req[target] = result.data
    next()
  }
}
