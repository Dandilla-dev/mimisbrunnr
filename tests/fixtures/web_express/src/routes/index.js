import v2Routes from './v2.routes.js';

// роутеры второй версии API подключаются функцией: registerRoutes(app) в server.js
export function registerRoutes(app) {
  app.use('/api/v2', v2Routes);
}
