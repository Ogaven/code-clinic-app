/**
 * One-time script: adds "Dry Socket Dressing" to the services table.
 * Run on the server after deploy:
 *   node /var/www/codeclinic/scripts/add-dry-socket-service.mjs
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

try {
  const existing = await prisma.service.findFirst({
    where: { name: { equals: 'Dry Socket Dressing', mode: 'insensitive' } },
  })
  if (existing) {
    console.log('Service already exists:', existing.name, '— no action taken.')
  } else {
    const svc = await prisma.service.create({
      data: {
        name:         'Dry Socket Dressing',
        description:  'Post-extraction dry socket treatment — irrigation and dressing placement.',
        category:     'Oral Surgery',
        durationMins: 30,
        priceUGX:     0,        // Justine to set correct price
        vatApplicable: true,
        colour:       '#F59E0B',
      },
    })
    console.log('Created:', svc.id, svc.name, '— price set to 0 (update in admin settings).')
  }
} catch (e) {
  console.error('Error:', e.message)
} finally {
  await prisma.$disconnect()
}
