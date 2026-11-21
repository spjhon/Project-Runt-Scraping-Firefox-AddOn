// ==========================================
// TIPOS E INTERFACES
// ==========================================

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

interface CaptchaReadyMessage {
  type: 'CAPTCHA_READY';
  captcha: string;
}

type ExtensionResponse = {
  success: boolean;
  requestId: string;
  message: string;
  tabId?: number | null;
  captcha?: string;
  payload?: Record<string, unknown>;
};

interface CaptchaRequest {
  type: 'REQUEST_CAPTCHA';
  requestId: string;
}

interface RuntDataRequest {
  type: 'REQUEST_DATA';
  requestId: string;
  tabId: number;
  tipoDocumento: string;
  numeroDocumento: string;
  captchaValue: string;
  placa: string;
}

interface SarlaftDualRequest {
  type: 'SARLAFT_DUAL_QUERY';
  requestId: string;
  numeroDocumento: string;
  nombreCompleto: string;
}

// ==========================================
// FUNCIONES DE PURIFICACIÓN (EXTRACTORS)
// ==========================================

function extractCaptchaRequest(message: unknown): CaptchaRequest | null {
  if (!message || typeof message !== 'object') return null;
  const msg = message as Record<string, unknown>;
  if (msg.type !== 'REQUEST_CAPTCHA') return null;
  if (typeof msg.requestId !== 'string' || msg.requestId.length === 0)
    return null;
  return { type: 'REQUEST_CAPTCHA', requestId: msg.requestId };
}

function extractRuntDataRequest(message: unknown): RuntDataRequest | null {
  if (!message || typeof message !== 'object') return null;
  const msg = message as Record<string, unknown>;
  if (msg.type !== 'REQUEST_DATA') return null;
  if (typeof msg.requestId !== 'string' || msg.requestId.length === 0)
    return null;
  if (
    typeof msg.tabId !== 'number' ||
    !Number.isInteger(msg.tabId) ||
    msg.tabId <= 0
  )
    return null;
  if (typeof msg.tipoDocumento !== 'string' || msg.tipoDocumento.length === 0)
    return null;
  if (
    typeof msg.numeroDocumento !== 'string' ||
    msg.numeroDocumento.length === 0
  )
    return null;
  if (typeof msg.captchaValue !== 'string' || msg.captchaValue.length === 0)
    return null;
  if (typeof msg.placa !== 'string' || msg.placa.length === 0) return null;

  return {
    type: 'REQUEST_DATA',
    requestId: msg.requestId,
    tabId: msg.tabId,
    tipoDocumento: msg.tipoDocumento,
    numeroDocumento: msg.numeroDocumento,
    captchaValue: msg.captchaValue,
    placa: msg.placa,
  };
}

function extractSarlaftDualRequest(
  message: unknown,
): SarlaftDualRequest | null {
  if (!message || typeof message !== 'object') return null;
  const msg = message as Record<string, unknown>;

  if (msg.type !== 'SARLAFT_DUAL_QUERY') return null;
  if (typeof msg.requestId !== 'string' || msg.requestId.length === 0)
    return null;
  if (
    typeof msg.numeroDocumento !== 'string' ||
    msg.numeroDocumento.length === 0
  )
    return null;
  if (typeof msg.nombreCompleto !== 'string' || msg.nombreCompleto.length === 0)
    return null;

  return {
    type: 'SARLAFT_DUAL_QUERY',
    requestId: msg.requestId,
    numeroDocumento: msg.numeroDocumento,
    nombreCompleto: msg.nombreCompleto,
  };
}

// ==========================================
// CONSTANTES
// ==========================================

const RUNT_URL =
  'https://portalpublico.runt.gov.co/#/consulta-vehiculo/consulta/consulta-ciudadana';
const OFAC_URL = 'https://sanctionssearch.ofac.treas.gov/';
const UN_URL = 'https://search.sanctions.un.org/';

const RUNT_READY_TIMEOUT = 20000;
const SARLAFT_READY_TIMEOUT = 15000;

// ==========================================
// BACKGROUND SCRIPT PRINCIPAL
// ==========================================

export default defineBackground(() => {
  console.log('[Extension] Background iniciado', { id: browser.runtime.id });

  browser.runtime.onMessage.addListener(
    async (message: unknown, sender: Browser.runtime.MessageSender) => {
      if (!message || typeof message !== 'object') return;
      const msg = message as Record<string, unknown>;

      // ==========================================
      // 1. CAPTURA DE PANTALLA (Debe ir primero para responder rápido)
      // ==========================================
      if (msg.type === 'CAPTURE_TAB_SCREENSHOT' && sender.tab?.id != null) {
        try {
          let dataUrl: string;

          if (import.meta.env.FIREFOX) {
            // Firefox: captura directamente la pestaña solicitada.
            // @ts-expect-error captureTab existe en Chrome 88+ pero no en los tipos del polyfill
            dataUrl = await browser.tabs.captureTab(sender.tab.id, {
              format: 'jpeg',
              quality: 85,
            });
          } else {
            // Chrome: necesita que la pestaña esté activa.
            const tabId = sender.tab.id;
            const windowId = sender.tab.windowId;

            const [previousTab] = await browser.tabs.query({
              active: true,
              windowId,
            });

            try {
              await browser.tabs.update(tabId, { active: true });

              dataUrl = await browser.tabs.captureVisibleTab(windowId, {
                format: 'jpeg',
                quality: 85,
              });
            } finally {
              // Restaurar la pestaña que estaba activa.
              if (previousTab?.id != null && previousTab.id !== tabId) {
                await browser.tabs.update(previousTab.id, { active: true });
              }
            }
          }

          const base64String = dataUrl.split(',')[1];

          if (!base64String) {
            throw new Error('La captura devolvió una imagen vacía.');
          }

          return {
            success: true,
            screenshot: base64String,
          };
        } catch (error) {
          console.error('[BG] Error al capturar pantalla:', error);

          return {
            success: false,
            screenshot: '',
          };
        }
      }

      // ==========================================
      // 2. CERRAR PESTAÑA
      // ==========================================
      if (msg.type === 'CLOSE_RUNT_TAB') {
        const request = message as RequestMessage;
        if (request.tabId == null) return;
        browser.tabs
          .get(request.tabId)
          .then(() => browser.tabs.remove(request.tabId!))
          .catch(() => {});
        return;
      }

      // ==========================================
      // 3. REQUEST_CAPTCHA
      // ==========================================
      if (msg.type === 'REQUEST_CAPTCHA') {
        const request = extractCaptchaRequest(message);
        if (!request) {
          return {
            success: false,
            requestId: '',
            captcha: '',
            message: 'Request ID no válido.',
          } satisfies ExtensionResponse;
        }

        console.log('[BG] REQUEST_CAPTCHA start:', request.requestId);

        try {
          const response = await new Promise<ExtensionResponse>(
            (resolve, reject) => {
              const timeout = setTimeout(() => {
                browser.runtime.onMessage.removeListener(captchaReadyListener);
                reject(
                  new Error('Tiempo de espera agotado esperando el CAPTCHA.'),
                );
              }, RUNT_READY_TIMEOUT);

              const captchaReadyListener = (msg: unknown) => {
                if (!msg || typeof msg !== 'object') return;
                if ((msg as { type?: string }).type === 'CAPTCHA_READY') {
                  clearTimeout(timeout);
                  browser.runtime.onMessage.removeListener(
                    captchaReadyListener,
                  );
                  resolve({
                    success: true,
                    requestId: request.requestId,
                    captcha: (msg as CaptchaReadyMessage).captcha,
                    tabId:
                      (request as RequestMessage & { tabId?: number }).tabId ??
                      null,
                    message: 'CAPTCHA obtenido correctamente.',
                  });
                }
                if ((msg as { type?: string }).type === 'CAPTCHA_ERROR') {
                  clearTimeout(timeout);
                  browser.runtime.onMessage.removeListener(
                    captchaReadyListener,
                  );
                  reject(new Error((msg as { message: string }).message));
                }
              };

              browser.runtime.onMessage.addListener(captchaReadyListener);

              browser.tabs
                .create({ url: RUNT_URL, active: false })
                .then((tab) => {
                  if (tab.id !== undefined)
                    (request as RequestMessage & { tabId: number }).tabId =
                      tab.id;
                })
                .catch((error) => {
                  clearTimeout(timeout);
                  browser.runtime.onMessage.removeListener(
                    captchaReadyListener,
                  );
                  reject(
                    new Error(
                      error instanceof Error
                        ? error.message
                        : 'No fue posible abrir la pestaña de RUNT.',
                    ),
                  );
                });
            },
          );
          return response;
        } catch (error) {
          return {
            success: false,
            requestId: request.requestId,
            captcha: '',
            tabId: null,
            message:
              error instanceof Error
                ? error.message
                : 'Error al obtener el CAPTCHA.',
          } satisfies ExtensionResponse;
        }
      }

      // ==========================================
      // 4. REQUEST_DATA (RUNT)
      // ==========================================
      if (msg.type === 'REQUEST_DATA') {
        const request = extractRuntDataRequest(message);
        if (!request) {
          return {
            success: false,
            requestId: '',
            tabId: null,
            message: 'Request ID no válido.',
          } satisfies ExtensionResponse;
        }

        await browser.tabs.update(request.tabId, { active: true });

        try {
          const response = await new Promise<ExtensionResponse>(
            (resolve, reject) => {
              const timeout = setTimeout(() => {
                browser.runtime.onMessage.removeListener(dataReadyListener);
                reject(
                  new Error(
                    'Tiempo de espera agotado esperando los datos del RUNT.',
                  ),
                );
              }, RUNT_READY_TIMEOUT);

              const dataReadyListener = (msg: unknown) => {
                if (!msg || typeof msg !== 'object') return;
                const typedMsg = msg as {
                  type?: string;
                  requestId?: string;
                  payload?: Record<string, unknown>;
                  message?: string;
                };

                if (
                  typedMsg.requestId !== undefined &&
                  typedMsg.requestId !== request.requestId
                )
                  return;

                if (typedMsg.type === 'DATA_READY') {
                  clearTimeout(timeout);
                  browser.runtime.onMessage.removeListener(dataReadyListener);
                  //void browser.tabs.remove(request.tabId).catch(() => {});
                  resolve({
                    success: true,
                    requestId: request.requestId,
                    tabId: request.tabId,
                    payload: typedMsg.payload ?? {},
                    message: 'Datos extraídos correctamente desde RUNT.',
                  });
                }

                if (typedMsg.type === 'DATA_ERROR') {
                  clearTimeout(timeout);
                  browser.runtime.onMessage.removeListener(dataReadyListener);
                  reject(
                    new Error(typedMsg.message ?? 'Error desconocido en RUNT.'),
                  );
                }
              };

              browser.runtime.onMessage.addListener(dataReadyListener);

              browser.tabs
                .sendMessage(request.tabId, {
                  type: 'SOLVE_CAPTCHA',
                  requestId: request.requestId,
                  tipoDocumento: request.tipoDocumento,
                  numeroDocumento: request.numeroDocumento,
                  captchaValue: request.captchaValue,
                  placa: request.placa,
                })
                .catch((error) => {
                  clearTimeout(timeout);
                  browser.runtime.onMessage.removeListener(dataReadyListener);
                  reject(
                    new Error(
                      error instanceof Error
                        ? error.message
                        : 'No se pudo comunicar con la pestaña del RUNT.',
                    ),
                  );
                });
            },
          );
          return response;
        } catch (error) {
          return {
            success: false,
            requestId: request.requestId,
            tabId: request.tabId,
            message:
              error instanceof Error
                ? error.message
                : 'Error al extraer los datos desde RUNT.',
          } satisfies ExtensionResponse;
        }
      }

      // ==========================================
      // 5. SARLAFT_DUAL_QUERY
      // ==========================================
      if (msg.type === 'SARLAFT_DUAL_QUERY') {
        const request = extractSarlaftDualRequest(message);

        if (!request) {
          console.log('[BG] SARLAFT_DUAL_QUERY inválido:', message);
          return {
            success: false,
            requestId: '',
            message: 'Datos de solicitud SARLAFT no válidos.',
          } satisfies ExtensionResponse;
        }

        console.log('[BG] SARLAFT_DUAL_QUERY start:', request.requestId);

        let ofacTabId: number | null = null;
        let unTabId: number | null = null;

        try {
          const response = await new Promise<ExtensionResponse>(
            (resolve, reject) => {
              const timeout = setTimeout(() => {
                browser.runtime.onMessage.removeListener(sarlaftListener);
                reject(
                  new Error(
                    'Tiempo de espera agotado (60s) en consultas SARLAFT.',
                  ),
                );
              }, SARLAFT_READY_TIMEOUT);

              let ofacResult: Record<string, unknown> | null = null;
              let unResult: Record<string, unknown> | null = null;

              const checkCompletion = () => {
                if (ofacResult && unResult) {
                  clearTimeout(timeout);
                  browser.runtime.onMessage.removeListener(sarlaftListener);
                  if (ofacTabId)
                    void browser.tabs.remove(ofacTabId).catch(() => {});
                  if (unTabId)
                    void browser.tabs.remove(unTabId).catch(() => {});
                  resolve({
                    success: true,
                    requestId: request.requestId,
                    payload: { ofac: ofacResult, un: unResult },
                    message:
                      'Consultas SARLAFT (OFAC y UN) completadas correctamente.',
                  });
                }
              };

              const sarlaftListener = (msg: unknown) => {
                if (!msg || typeof msg !== 'object') return;
                const typedMsg = msg as {
                  type?: string;
                  requestId?: string;
                  payload?: Record<string, unknown>;
                  message?: string;
                };

                if (
                  typedMsg.requestId !== undefined &&
                  typedMsg.requestId !== request.requestId
                )
                  return;

                if (typedMsg.type === 'OFAC_REQUEST_PENDING_ID') {
                  console.log(
                    '[BG] OFAC pide requestId pendiente, respondiendo...',
                  );
                  // Responder al content script de OFAC con el requestId original
                  if (ofacTabId) {
                    browser.tabs
                      .sendMessage(ofacTabId, {
                        type: 'SOLVE_SARLAFT_OFAC',
                        requestId: request.requestId,
                        nombreCompleto: request.nombreCompleto,
                      })
                      .catch((err) =>
                        console.error('[BG] Error respondiendo a OFAC:', err),
                      );
                  }
                }

                // ==========================================
                // NUEVO: Escuchar que el script cargó y enviarle los datos
                // ==========================================
                if (typedMsg.type === 'OFAC_SCRIPT_READY') {
                  console.log('[BG] 🟢 OFAC Script Ready. Enviando datos...');
                  if (ofacTabId) {
                    browser.tabs
                      .sendMessage(ofacTabId, {
                        type: 'SOLVE_SARLAFT_OFAC',
                        requestId: request.requestId,
                        nombreCompleto: request.nombreCompleto,
                      })
                      .catch((err) =>
                        console.error('[BG] Error enviando a OFAC:', err),
                      );
                  }
                }

                if (typedMsg.type === 'UN_SCRIPT_READY') {
                  console.log('[BG] 🟢 UN Script Ready. Enviando datos...');
                  if (unTabId) {
                    browser.tabs
                      .sendMessage(unTabId, {
                        type: 'SOLVE_SARLAFT_UN',
                        requestId: request.requestId,
                        numeroDocumento: request.numeroDocumento,
                        nombreCompleto: request.nombreCompleto,
                      })
                      .catch((err) =>
                        console.error('[BG] Error enviando a UN:', err),
                      );
                  }
                }
                if (typedMsg.type === 'SARLAFT_UN_READY') {
                  // console.log('[BG] 📦 UN datos recibidos');
                  unResult = typedMsg.payload ?? {}; // <-- 1. Primero asignas el valor
                  //console.log('RESULTADO UN: ', unResult); // <-- 2. Luego lo imprimes (ya no será null)
                  checkCompletion();
                }
                if (typedMsg.type === 'SARLAFT_OFAC_READY') {
                  //console.log('[BG] 📦 OFAC datos recibidos');
                  ofacResult = typedMsg.payload ?? {};
                  //console.log('RESULTADO OFAC: ', ofacResult);
                  checkCompletion();
                }

                if (typedMsg.type === 'SARLAFT_OFAC_ERROR') {
                  clearTimeout(timeout);
                  browser.runtime.onMessage.removeListener(sarlaftListener);
                  reject(
                    new Error(
                      `OFAC Error: ${typedMsg.message ?? 'Error desconocido'}`,
                    ),
                  );
                }

                if (typedMsg.type === 'SARLAFT_UN_ERROR') {
                  clearTimeout(timeout);
                  browser.runtime.onMessage.removeListener(sarlaftListener);
                  reject(
                    new Error(
                      `UN Error: ${typedMsg.message ?? 'Error desconocido'}`,
                    ),
                  );
                }
              };

              browser.runtime.onMessage.addListener(sarlaftListener);

              Promise.all([
                browser.tabs.create({ url: OFAC_URL, active: false }),
                browser.tabs.create({ url: UN_URL, active: false }),
              ])
                .then(([ofacTab, unTab]) => {
                  if (ofacTab.id !== undefined) ofacTabId = ofacTab.id;
                  if (unTab.id !== undefined) unTabId = unTab.id;

                  console.log('[BG] Pestañas SARLAFT abiertas:', {
                    ofacTabId,
                    unTabId,
                  });
                })
                .catch((error) => {
                  clearTimeout(timeout);
                  browser.runtime.onMessage.removeListener(sarlaftListener);
                  reject(
                    new Error(
                      error instanceof Error
                        ? error.message
                        : 'No fue posible abrir las pestañas de SARLAFT.',
                    ),
                  );
                });
            },
          );

          console.log('Response de la promesa: ', response);

          return response;
        } catch (error) {
          console.error('[Background] Error en SARLAFT_DUAL_QUERY:', error);

          if (ofacTabId) void browser.tabs.remove(ofacTabId).catch(() => {});
          if (unTabId) void browser.tabs.remove(unTabId).catch(() => {});

          return {
            success: false,
            requestId: request.requestId,
            message:
              error instanceof Error
                ? error.message
                : 'Error al realizar las consultas SARLAFT.',
          } satisfies ExtensionResponse;
        }
      }
    },
  );
});
