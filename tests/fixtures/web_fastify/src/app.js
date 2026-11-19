import Fastify from 'fastify';
import { notesRoutes } from './notes.routes.js';
import { verifyUser } from './auth.js';

const app = Fastify({ logger: true });
app.addHook('onRequest', verifyUser);
app.register(notesRoutes, { prefix: '/v1' });

app.listen({ port: 3000 });
