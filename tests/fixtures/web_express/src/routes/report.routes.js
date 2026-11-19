import { Router } from 'express';

const router = Router();

router.get('/daily', (req, res) => res.json({ report: 'daily' }));

export default router;
