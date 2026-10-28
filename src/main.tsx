import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import './ui/styles.css';
class Boundary extends React.Component<React.PropsWithChildren, { error: string }> {
  state = { error: '' };
  static getDerivedStateFromError(e: Error) {
    return { error: e.message };
  }
  render() {
    return this.state.error ? (
      <main className="fatal">
        <h1>Không mở được xưởng 3D</h1>
        <p>{this.state.error}</p>
        <p>Dữ liệu đã lưu vẫn nằm trong thư mục data.</p>
        <button onClick={() => location.reload()}>Tải lại ứng dụng</button>
      </main>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById('root')!).render(
  <Boundary>
    <App />
  </Boundary>,
);
