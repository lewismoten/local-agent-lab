import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ConfirmDialogProvider } from './ConfirmDialog';
import './style.css';
import './chat.css';
import './theme.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode><ConfirmDialogProvider><App /></ConfirmDialogProvider></React.StrictMode>);
