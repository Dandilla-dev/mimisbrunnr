import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { loadPlugins } from 'plugin-loader';
import { registerRoutes } from './routes/index.js';
import libraryRoutes from './routes/library.routes.js';
import { requireToken } from './middlewares/auth.middleware.js';
import errorHandler from './middlewares/error.middleware.js';
import admin from './admin.js';
import reportRoutes from './routes/report.routes.js';

const app = express();
app.use(express.json());
app.use(cors());
if (process.env.NODE_ENV !== 'production') app.use(morgan('dev'));
app.use('/api', requireToken, libraryRoutes);
app.use('/admin', admin);

// роутеры отчётов подключаются в цикле — что именно, по коду не понять
for (const r of [reportRoutes]) app.use('/reports', r);
registerRoutes(app);

// список плагинов собирается в чужом пакете — что в нём, по коду не понять
for (const r of loadPlugins()) app.use(r);

app.use(errorHandler);
app.use((req, res) => res.status(404).send('Not Found'));

app.listen(process.env.PORT || 3000);
