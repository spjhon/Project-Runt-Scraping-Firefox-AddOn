// ============================================================
// CONTENT SCRIPT: OFAC SARLAFT SCRAPER
// Estrategia: detectar estado del DOM para sobrevivir al
// postback de ASP.NET sin localStorage.
// ============================================================

interface SolveOfacMessage {
  type: 'SOLVE_SARLAFT_OFAC';
  requestId: string;
  nombreCompleto?: string;
}

// Selectores constantes
const SELECTORS = {
  nameInput: '#ctl00_MainContent_txtLastName',
  searchButton: '#ctl00_MainContent_btnSearch',
  noResults: '#ctl00_MainContent_pnlMessage .errormessage',
  resultsTable: '#gvSearchResults',
} as const;

const OFAC_READY_TIMEOUT = 10_000;

// ============================================================
// UTILIDADES
// ============================================================

function waitForElement<T extends HTMLElement>(
  selector: string,
  timeout = OFAC_READY_TIMEOUT,
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
// DETECCIÓN DE ESTADO DEL DOM
// ============================================================

type OfacDomState =
  | {
      estado: 'RESULTADOS_LISTOS';
      tipo: 'RESULTS';
      resultado: Record<string, string | null> | null;
    }
  | { estado: 'SIN_RESULTADOS'; tipo: 'NO_RESULTS'; resultado: null }
  | { estado: 'ESPERANDO' };

function detectOfacDomState(): OfacDomState {
  // 1. ¿Mensaje de "sin resultados"?
  if (document.querySelector(SELECTORS.noResults)) {
    return { estado: 'SIN_RESULTADOS', tipo: 'NO_RESULTS', resultado: null };
  }

  // 2. ¿Tabla de resultados?
  const resultsTableEl = document.querySelector<HTMLElement>(
    SELECTORS.resultsTable,
  );
  if (resultsTableEl) {
    const firstRow = resultsTableEl.querySelector('tbody tr');
    let resultado: Record<string, string | null> | null = null;

    if (firstRow) {
      const cells = firstRow.querySelectorAll('td');
      resultado = {
        program: cells[3]?.textContent?.trim() ?? null,
        list: cells[4]?.textContent?.trim() ?? null,
        score: cells[5]?.textContent?.trim() ?? null,
      };
    }

    return { estado: 'RESULTADOS_LISTOS', tipo: 'RESULTS', resultado };
  }

  // 3. Nada → aún no hay resultados
  return { estado: 'ESPERANDO' };
}

// ============================================================
// ENVÍO DEL RESULTADO AL BACKGROUND
// ============================================================

async function enviarResultado(
  requestId: string,
  tipo: 'NO_RESULTS' | 'RESULTS',
  resultado: Record<string, string | null> | null,
): Promise<void> {
  const coincidencia = tipo === 'RESULTS';
  const messageText = coincidencia
    ? 'Se encontraron coincidencias en OFAC.'
    : 'No se encontraron coincidencias en OFAC.';

  console.log('[OFAC] Solicitando captura de pantalla...');
  const screenshotResponse = await browser.runtime.sendMessage({
    type: 'CAPTURE_TAB_SCREENSHOT',
  });
  const screenshotBase64 =
    (screenshotResponse as { screenshot?: string })?.screenshot || '';

  await browser.runtime.sendMessage({
    type: 'SARLAFT_OFAC_READY',
    requestId,
    payload: {
      coincidencia,
      message: messageText,
      resultado,
      screenshot: screenshotBase64,
    },
  });

  console.log('[OFAC] Proceso completado exitosamente.');
}

// ============================================================
// INYECCIÓN + CLIC (primera carga)
// ============================================================

async function inyectarYBuscar(nombreCompleto: string): Promise<void> {
  console.log('[OFAC] Inyectando nombre y haciendo clic...');

  const [nameInput, searchButton] = await Promise.all([
    waitForElement<HTMLInputElement>(SELECTORS.nameInput),
    waitForElement<HTMLElement>(SELECTORS.searchButton),
  ]);

  nameInput.value = '';
  nameInput.focus(); // ASP.NET necesita el foco para registrar el cambio
  setInputValue(nameInput, nombreCompleto);

  // Pausa para que ASP.NET habilite el botón
  await new Promise((r) => setTimeout(r, 500));

  console.log('[OFAC] Clic en Search (provocará postback)...');
  clickElement(searchButton);
  // La página se recargará; este script morirá.
}

// ============================================================
// CONTENT SCRIPT PRINCIPAL
// ============================================================

export default defineContentScript({
  matches: ['https://sanctionssearch.ofac.treas.gov/*'],
  runAt: 'document_idle',

  main() {
    console.log('[OFAC Extension] Content Script activo en:', location.href);

    // ----------------------------------------------------------
    // 1. Listener de mensajes del background
    // ----------------------------------------------------------
    browser.runtime.onMessage.addListener((message: unknown) => {
      if (!message || typeof message !== 'object') return;

      const msg = message as SolveOfacMessage;
      if (msg.type !== 'SOLVE_SARLAFT_OFAC') return;
      if (!msg.requestId || !msg.nombreCompleto) {
        console.error('[OFAC] Datos incompletos en el mensaje.');
        return;
      }

      // ¿Ya hay resultados en el DOM? (caso postback)
      const estado = detectOfacDomState();

      if (estado.estado !== 'ESPERANDO') {
        console.log(
          '[OFAC] Ya hay resultados en DOM, extrayendo sin reinyectar...',
        );
        return enviarResultado(
          msg.requestId,
          estado.tipo,
          estado.resultado,
        ).catch((error) => {
          console.error('[OFAC] Error extrayendo:', error);
          return browser.runtime
            .sendMessage({
              type: 'SARLAFT_OFAC_ERROR',
              requestId: msg.requestId,
              message:
                error instanceof Error
                  ? error.message
                  : 'Error extrayendo OFAC',
            })
            .catch(() => {});
        });
      }

      // Página limpia: inyectar y buscar
      return inyectarYBuscar(msg.nombreCompleto).catch((error) => {
        console.error('[OFAC] Error inyectando:', error);
        return browser.runtime
          .sendMessage({
            type: 'SARLAFT_OFAC_ERROR',
            requestId: msg.requestId,
            message:
              error instanceof Error
                ? error.message
                : 'Error al inyectar en OFAC',
          })
          .catch(() => {});
      });
    });

    // ----------------------------------------------------------
    // 2. Al arrancar: decidir si pedimos requestId o avisamos READY
    // ----------------------------------------------------------
    const estado = detectOfacDomState();

    if (estado.estado !== 'ESPERANDO') {
      // Ya hay resultados: pedir al background el requestId pendiente
      console.log(
        '[OFAC] Resultados detectados al arrancar. Pidiendo requestId...',
      );
      browser.runtime
        .sendMessage({ type: 'OFAC_REQUEST_PENDING_ID' })
        .catch(() => {});
    } else {
      // Página limpia: avisar READY para que el background envíe la orden
      console.log('[OFAC] Página limpia. Avisando OFAC_SCRIPT_READY...');
      browser.runtime
        .sendMessage({ type: 'OFAC_SCRIPT_READY' })
        .catch(() => {});
    }
  },
});
