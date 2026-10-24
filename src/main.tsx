import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { startCounting } from './lib/analytics';

startCounting();

createRoot(document.getElementById('root')!).render(<App />);
