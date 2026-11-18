import { useDispatch, useSelector } from 'react-redux';
import { removeItem } from './cartSlice';
import { formatPrice } from '../../utils/format';

export function useCart() {
  const items = useSelector((s) => s.cart.items);
  const dispatch = useDispatch();
  const total = formatPrice(items.reduce((sum, i) => sum + i.price, 0));
  const remove = (id) => dispatch(removeItem(id));
  return { items, total, remove };
}
