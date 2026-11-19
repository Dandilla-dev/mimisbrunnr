import express from 'express';
import cors from 'cors';
import libraryRoutes from './routes/library.routes.js';
import { requireToken } from './middlewares/auth.middleware.js';
import errorHandler from './middlewares/error.middleware.js';

const app = express();
app.use(express.json());
app.use(cors());
app.use('/api', requireToken, libraryRoutes);
app.use(errorHandler);
app.use((req, res) => res.status(404).send('Not Found'));

app.listen(process.env.PORT || 3000);
