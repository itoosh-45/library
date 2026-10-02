import { Component, type ReactNode } from 'react';

export function StorageError() {
  return <main className="storage-error"><h1>לא הצלחנו לפתוח את הספרייה</h1><p role="alert">הדפדפן לא אפשר גישה לנתונים המקומיים. נסה לפתוח מחדש או לבדוק שהאחסון בדפדפן זמין.</p><p>לא מחקנו את הספרייה.</p><button onClick={() => window.location.reload()}>ניסיון נוסף</button></main>;
}
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <StorageError /> : this.props.children; }
}
