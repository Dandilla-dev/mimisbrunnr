const orders = [];

function listOrders(customer) {
  return orders.filter((o) => o.customer === customer);
}

function addOrder(order) {
  orders.push(order);
  return orders.length;
}

exports.countOrders = () => orders.length;
module.exports = { listOrders, addOrder, countOrders: exports.countOrders };
