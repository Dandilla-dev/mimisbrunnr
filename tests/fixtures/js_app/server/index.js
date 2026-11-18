const express = require('express');
const { listOrders, addOrder } = require('./orders');

const app = express();
app.use(express.json());

app.get('/api/orders/:customer', (req, res) => {
  res.json(listOrders(req.params.customer));
});

app.post('/api/orders', (req, res) => {
  res.json({ id: addOrder(req.body) });
});

app.listen(3000);
