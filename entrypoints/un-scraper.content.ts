// ============================================================
// CONTENT SCRIPT: NACIONES UNIDAS (UN) SARLAFT SCRAPER
// Migrado desde Playwright API a WXT Content Script
// ============================================================

interface SolveUnMessage {
  type: 'SOLVE_SARLAFT_UN';
  requestId: string;
  numeroDocumento?: string;
  nombreCompleto?: string;
}

// Selectores constantes (los mismos de tu API de Playwright)
const SELECTORS = {
  searchInput:
    '#root > div > div > form > div.search-inputs-container > div.search-inputfield-container > div > div > input',
  searchButton:
    '#root > div > div > form > div.search-inputs-container > div.search-btns > button',
  totalCount:
    '#root > div > div.pagination-container > div > div.total-results > span',
  // Selector de error genérico: si la app de la ONU falla, suele mostrar un mensaje de error
  // o simplemente no renderiza el contador. Añadimos un selector para detectar errores de red/API.
  errorContainer:
    '#root > div > div.error-message, #root > div > div > div.error',
} as const;

const UN_READY_TIMEOUT = 15_000; // Tiempo máximo para que input y botón aparezcan
const UN_RESULT_TIMEOUT = 20_000; // Tiempo máximo para esperar resultados o error tras la búsqueda

// ============================================================
// UTILIDADES (copiadas de tu implementación de RUNT/OFAC)
// ============================================================

function waitForElement<T extends HTMLElement>(
  selector: string,
  timeout = 10_000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const interval = setInterval(() => {
      const el = document.querySelector<T>(selector);
      if (el) {
        clearInterval(interval);
        resolve(el);
        return;
      }
      if (Date.now() - start >= timeout) {
        clearInterval(interval);
        reject(new Error(`No apareció el elemento: ${selector}`));
      }
    }, 300);
  });
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function clickElement(el: HTMLElement) {
  el.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true, view: window }),
  );
}

// ============================================================
// MANEJADOR ASÍNCRONO (separado para claridad)
// ============================================================

async function handleSarlaftUN(msg: SolveUnMessage) {
  const { requestId, numeroDocumento } = msg;

  console.log('[UN] Iniciando consulta para documento:', numeroDocumento);

  try {
    // --------------------------------------------------------
    // 1. Ejecutar la espera + inyección + resultado
    // --------------------------------------------------------
    const { totalCount } = await waitForUNReadyAndResult(numeroDocumento!);

    // --------------------------------------------------------
    // 2. Determinar coincidencia
    // --------------------------------------------------------
    const coincidencia = totalCount > 0;
    const messageText = coincidencia
      ? 'Se encontraron coincidencias en la lista de sancionados de las Naciones Unidas.'
      : 'NO se encontraron coincidencias en la lista de sancionados de las Naciones Unidas.';
    const resultado = coincidencia
      ? 'Se encontraron coincidencias'
      : 'NO se encontraron coincidencias';

    console.log(`[UN] ${coincidencia ? '🔴' : '🟢'} ${messageText}`);

    // --------------------------------------------------------
    // 3. Solicitar captura de pantalla al Background
    // --------------------------------------------------------
    console.log('[UN] Solicitando captura de pantalla...');
    const screenshotResponse = await browser.runtime.sendMessage({
      type: 'CAPTURE_TAB_SCREENSHOT',
    });
    const screenshotBase64 =
      (screenshotResponse as { screenshot?: string })?.screenshot || '';

    // --------------------------------------------------------
    // 4. Enviar resultado final al Background
    // --------------------------------------------------------
    await browser.runtime.sendMessage({
      type: 'SARLAFT_UN_READY',
      requestId,
      payload: {
        coincidencia,
        message: messageText,
        resultado,
        screenshot: screenshotBase64,
      },
    });

    console.log('[UN] Proceso completado exitosamente.');
  } catch (error) {
    // --------------------------------------------------------
    // 5. Manejo de errores
    // --------------------------------------------------------
    console.error('[UN] Error durante la consulta:', error);

    await browser.runtime.sendMessage({
      type: 'SARLAFT_UN_ERROR',
      requestId,
      message:
        error instanceof Error
          ? error.message
          : 'Error desconocido en Naciones Unidas',
    });
  }
}

// ============================================================
// FUNCIÓN PRINCIPAL DE ESPERA (SOLUCIÓN A TU PROBLEMA)
// ============================================================

/**
 * Espera a que la página de la ONU esté lista (input y botón presentes),
 * luego inyecta los datos y hace la consulta.
 * Finalmente, espera el resultado (contador) o un error.
 *
 * Retorna un objeto con el total de resultados o lanza un error si algo falla.
 */
async function waitForUNReadyAndResult(
  numeroDocumento: string,
): Promise<{ totalCount: number }> {
  // ----------------------------------------------------------
  // FASE 1: Esperar a que la UI esté lista (input + botón)
  // ----------------------------------------------------------
  console.log('[UN] Fase 1: Esperando que la UI esté lista...');

  const [searchInput, searchButton] = await Promise.all([
    waitForElement<HTMLInputElement>(SELECTORS.searchInput, UN_READY_TIMEOUT),
    waitForElement<HTMLElement>(SELECTORS.searchButton, UN_READY_TIMEOUT),
  ]);

  console.log('[UN] UI lista. Input y botón encontrados.');

  // ----------------------------------------------------------
  // FASE 2: Inyectar el número de documento
  // ----------------------------------------------------------
  searchInput.value = '';
  searchInput.focus();
  setInputValue(searchInput, numeroDocumento);
  console.log('[UN] Documento inyectado:', numeroDocumento);

  // Pequeña pausa para que React procese el cambio (igual que en tu API)
  await new Promise((r) => setTimeout(r, 300));

  // ----------------------------------------------------------
  // FASE 3: Hacer clic en buscar
  // ----------------------------------------------------------
  clickElement(searchButton);
  console.log('[UN] Búsqueda enviada.');

  // ----------------------------------------------------------
  // FASE 4: Esperar el resultado O un error (Race condition)
  // ----------------------------------------------------------
  console.log('[UN] Fase 4: Esperando resultados o error...');

  return new Promise((resolve, reject) => {
    const start = Date.now();
    const interval = setInterval(() => {
      // 4.1. ¿Apareció el contador de resultados? (ÉXITO)
      const totalCountElement = document.querySelector<HTMLElement>(
        SELECTORS.totalCount,
      );

      if (totalCountElement) {
        clearInterval(interval);
        const totalCountText = totalCountElement.textContent;
        const totalCount = Number(
          totalCountText?.replace('Total:', '').trim() ?? '0',
        );
        console.log('[UN] Resultados obtenidos. Total:', totalCount);
        resolve({ totalCount });
        return;
      }

      // 4.2. ¿Apareció un error explícito en la UI? (ERROR)
      // Nota: La web de la ONU no siempre muestra errores; a veces simplemente
      // no renderiza el contador. Detectamos ambos casos.
      const errorElement = document.querySelector<HTMLElement>(
        SELECTORS.errorContainer,
      );

      if (errorElement) {
        clearInterval(interval);
        reject(
          new Error(
            `Error en la consulta de la ONU: ${errorElement.textContent?.trim() || 'Error desconocido'}`,
          ),
        );
        return;
      }

      // 4.3. ¿Timeout? (ERROR)
      if (Date.now() - start >= UN_RESULT_TIMEOUT) {
        clearInterval(interval);
        // En este punto, ni el contador ni un error aparecieron.
        // Esto puede pasar si la consulta falló silenciosamente o la red está lenta.
        reject(
          new Error(
            'Tiempo de espera agotado esperando resultados de la ONU. ' +
              'Es posible que la consulta haya fallado o no haya respuesta.',
          ),
        );
      }
    }, 300);
  });
}

// ============================================================
// CONTENT SCRIPT PRINCIPAL
// ============================================================

// ============================================================
// CONTENT SCRIPT PRINCIPAL
// ============================================================

export default defineContentScript({
  matches: ['https://search.sanctions.un.org/*'],
  runAt: 'document_idle',

  main() {
    console.log('[UN Extension] Content Script activo en:', location.href);

    // ----------------------------------------------------------
    // 1. Listener de mensajes desde el Background
    // ----------------------------------------------------------
    browser.runtime.onMessage.addListener((message: unknown) => {
      if (!message || typeof message !== 'object') return;

      const msg = message as SolveUnMessage;

      console.log('[UN] Mensaje recibido:', msg);

      if (msg.type !== 'SOLVE_SARLAFT_UN') return;
      if (!msg.requestId || !msg.numeroDocumento) {
        console.error('[UN] Datos incompletos en el mensaje.');
        return;
      }

      return handleSarlaftUN(msg);
    });

    // ----------------------------------------------------------
    // 2. ¡AQUÍ ESTÁ LO QUE PEDISTE! Avisar al Background que estamos listos
    // ----------------------------------------------------------
    browser.runtime
      .sendMessage({
        type: 'UN_SCRIPT_READY', // <-- Este es el mensaje que recibirá el background
      })
      .catch(() => {
        // Usamos .catch() vacío intencionalmente.
        // Si la pestaña se cierra antes de que el background lo lea,
        // esto evita que salte un error rojo en la consola.
      });

    console.log('[UN] Listener registrado y notificación de READY enviada.');
  },
});
