import { formatPrice } from '../../utils/format';

export const CartItem = ({ item, onRemove }) => (
  <li>
    {item.name} — {formatPrice(item.price)}
    <button onClick={() => onRemove(item.id)}>Убрать</button>
  </li>
);
