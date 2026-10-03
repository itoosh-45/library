import { createRoot } from 'react-dom/client';
import { LibraryStartup } from './LibraryStartup';
import './style.css';

const root = createRoot(document.getElementById('root')!);
root.render(<LibraryStartup />);
