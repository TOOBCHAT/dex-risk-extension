import './chromeMock'; // Dev-only chrome API shim
import React from 'react';
import ReactDOM from 'react-dom/client';
import OptionsApp from './OptionsApp';
import './options.css';


ReactDOM.createRoot(document.getElementById('options-root')!).render(
  <React.StrictMode>
    <OptionsApp />
  </React.StrictMode>
);
