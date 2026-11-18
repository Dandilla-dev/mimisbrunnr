import { useCart } from './useCart';
import { CartItem } from './CartItem';

export default function CartPage() {
  const { items, total, remove } = useCart();

  function handleRemove(id) {
    if (items.length) remove(id);
  }

  return (
    <section>
      <ul>
        {items.map((i) => <CartItem key={i.id} item={i} onRemove={handleRemove} />)}
      </ul>
      <p>Итого: {total}</p>
    </section>
  );
}
