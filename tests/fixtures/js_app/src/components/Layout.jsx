import { memo } from 'react';

const Layout = memo(function Layout({ title, children }) {
  return (
    <div className="layout">
      <h1>{title}</h1>
      <main>{children}</main>
    </div>
  );
});

export default Layout;
