import { makeClient } from './client';

export async function loadOrders(customer: string) {
  const client = makeClient();
  return client.get(`/orders/${customer}`);
}
