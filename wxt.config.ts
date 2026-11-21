import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],

  dev: {
    server: {
      port: 3020,
      strictPort: true,
    },
  },

  manifest: {
    permissions: ['activeTab', 'tabs', 'scripting'],
    host_permissions: ['<all_urls>'],
    browser_specific_settings: {
      gecko: {
        id: 'project-runt-scraping@cdApp.com',
      },
    },
  },
});
