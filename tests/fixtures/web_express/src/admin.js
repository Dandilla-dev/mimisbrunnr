import express from 'express';

// отдельное маленькое приложение для администратора — подключается в server.js по адресу /admin
const admin = express();

admin.get('/stats', (req, res) => res.json({ ok: true }));

export default admin;
