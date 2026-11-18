import Layout from './components/Layout';
import CartPage from './features/cart/CartPage';

/** Корень приложения: рамка страницы и корзина. */
export default function App() {
  return (
    <Layout title="Магазин">
      <CartPage />
    </Layout>
  );
}
