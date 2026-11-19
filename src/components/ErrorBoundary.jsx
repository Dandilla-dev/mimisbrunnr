// Если в какой-то части окна случилась ошибка, падает только эта часть,
// а не всё окно (раньше в таком случае оставался пустой тёмный экран).
import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) {
    try { window.mimis?.logError?.(`${error?.stack || error}\n${info?.componentStack || ''}`); } catch { /* журнал недоступен */ }
  }
  componentDidUpdate(prev) {
    // перешли на другой экран — пробуем снова
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null }); // eslint-disable-line react/no-did-update-set-state
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="relative z-10 flex-1 p-8">
        <div className="card px-5 py-4 max-w-[720px]">
          <div className="font-display font-semibold text-[17px]">Эта часть окна не открылась</div>
          <p className="text-[13.5px] text-mist mt-1.5 leading-relaxed">
            Случилась ошибка в интерфейсе. Разборы и настройки не пострадали. Подробности записаны в журнал (Настройки → Данные).
          </p>
          <pre className="font-mono text-[11.5px] text-danger-soft mt-3 whitespace-pre-wrap break-all max-h-40 overflow-auto scroll-thin">{String(this.state.error?.message || this.state.error)}</pre>
          <div className="flex gap-2 mt-4">
            <button className="btn" onClick={() => { this.setState({ error: null }); this.props.onBack?.(); }}>Назад</button>
            <button className="btn" onClick={() => window.location.reload()}>Перезагрузить окно</button>
          </div>
        </div>
      </div>
    );
  }
}
