import { PrismaClient } from '@prisma/client'

// Single shared instance — Node's module cache ensures only one is created.
export const prisma = new PrismaClient()
