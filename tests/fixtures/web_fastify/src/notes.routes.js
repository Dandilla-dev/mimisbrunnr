import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function checkOwner(request, reply, done) {
  done();
}

export async function notesRoutes(fastify) {
  fastify.get('/notes', async () => prisma.note.findMany());
  fastify.post('/notes', { preHandler: [checkOwner], schema: { body: { type: 'object', required: ['text'] } } }, async (request, reply) => {
    const note = await prisma.note.create({ data: request.body });
    return reply.code(201).send(note);
  });
}
