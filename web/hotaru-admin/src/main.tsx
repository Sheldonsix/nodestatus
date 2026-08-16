import { ConfigProvider } from 'antd';
import zhCN from 'antd/lib/locale/zh_CN';
import React from 'react';

import ReactDOM from 'react-dom';
import App from './App';
import { I18nProvider } from './i18n';
import 'virtual:svg-icons-register';

/* Ant Design */
import 'antd/dist/antd.css';
/* UnoCSS */
import 'virtual:uno.css';
import '@unocss/reset/tailwind-compat.css';

ReactDOM.render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN}>
      <I18nProvider>
        <App />
      </I18nProvider>
    </ConfigProvider>
  </React.StrictMode>,
  document.getElementById('root'),
);
