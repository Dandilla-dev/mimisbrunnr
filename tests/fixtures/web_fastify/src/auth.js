export async function verifyUser(request, reply) {
  if (!request.headers.authorization) reply.code(401).send({ error: 'unauthorized' });
}
