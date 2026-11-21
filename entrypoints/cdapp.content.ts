interface RequestMessage {
  type:
    | 'REQUEST_CAPTCHA'
    | 'REQUEST_DATA'
    | 'CLOSE_RUNT_TAB'
    | 'SARLAFT_DUAL_QUERY';
  requestId: string;
  tabId?: number | null;
  tipoDocumento?: string;
  numeroDocumento?: string;
  captchaValue?: string;
  placa?: string;
  nombreCompleto?: string;
}

type ExtensionResponse = {
  success: boolean;
  requestId: string;
  message: string;
  tabId?: number | null;
  captcha?: string;
  payload?: Record<string, unknown>;
};

function isAllowedOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);

    const isProduction =
      url.protocol === 'https:' &&
      (url.hostname === 'cda-app.com' || url.hostname.endsWith('.cda-app.com'));

    const isLocal =
      url.protocol === 'http:' &&
      (url.hostname === 'cda-app' || url.hostname.endsWith('.cda-app'));

    return isProduction || isLocal;
  } catch {
    return false;
  }
}

export default defineContentScript({
  matches: [
    'https://cda-app.com/*',
    'https://*.cda-app.com/*',
    'http://cda-app/*',
    'http://*.cda-app/*',
    'https://cda-app/*',
    'https://*.cda-app/*',
    'https://cda-app:3000/*',
    'https://*.cda-app:3000/*',
    'http://cda-app:3000/*',
    'http://*.cda-app:3000/*',

    // ✅ Entorno de Producción
    'https://cda-app.com/*',
    'https://*.cda-app.com/*',
  ],
  noScriptStartedPostMessage: true,
  main() {
    console.log('[cdApp Extension] Content Script activo');

    window.addEventListener(
      'message',
      async (event: MessageEvent<RequestMessage>) => {
        if (event.source !== window) return;
        if (!isAllowedOrigin(event.origin)) return;

        // ✅ AND, no OR: solo descartamos tipos que no nos interesan
        if (
          !event.data ||
          typeof event.data !== 'object' ||
          (event.data.type !== 'REQUEST_CAPTCHA' &&
            event.data.type !== 'REQUEST_DATA' &&
            event.data.type !== 'CLOSE_RUNT_TAB' &&
            event.data.type !== 'SARLAFT_DUAL_QUERY')
        ) {
          return;
        }

        try {
          console.log('Peticion enviada desde cdapp content al background');

          // ✅ Reenviamos el mensaje completo (incluye payload de REQUEST_DATA)
          const response = (await browser.runtime.sendMessage({
            ...event.data,
          })) as ExtensionResponse;

          console.log(
            'Respuesta del background recibida correctamente en cdapp content.',
          );

          window.postMessage(
            {
              type: 'CDAPP_EXTENSION_RESPONSE',
              requestId: response.requestId,
              response,
            },
            event.origin,
          );
        } catch (error) {
          console.error('[cdApp Extension] Error:', error);
        }
      },
    );
  },
});
