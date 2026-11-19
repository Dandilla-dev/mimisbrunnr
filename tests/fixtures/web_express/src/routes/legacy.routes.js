import { Router } from 'express';

// старый роутер: где он подключается, по коду не видно (возможно, через loadPlugins)
const router = Router();

router.get('/old', (req, res) => res.send('old'));

export default router;
