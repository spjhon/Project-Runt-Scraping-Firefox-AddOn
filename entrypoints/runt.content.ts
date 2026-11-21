interface SolveCaptchaMessage {
  type: 'SOLVE_CAPTCHA';
  requestId: string;
  tipoDocumento?: string;
  numeroDocumento?: string;
  captchaValue?: string;
  placa?: string;
}

const MAPEO_DOCUMENTOS: Record<string, string> = {
  cedula_ciudadania: 'Cédula Ciudadanía',
  nit: 'NIT',
  pasaporte: 'Pasaporte',
  cedula_extranjeria: 'Cédula de Extranjería',
  tarjeta_identidad: 'Tarjeta de Identidad',
  registro_civil: 'Registro Civil',
  carnet_diplomatico: 'Carnet Diplomático',
  permiso_por_proteccion_temporal: 'Permiso por Protección Temporal',
};

function waitForRTM(selectorFecha: string, timeout = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();

    const interval = setInterval(() => {
      // Buscar el panel RTM
      const headerRTM = Array.from(
        document.querySelectorAll<HTMLElement>('mat-expansion-panel-header'),
      ).find((header) =>
        header.textContent?.includes('revisión técnico mecánica'),
      );

      // Si el vehículo no tiene panel RTM, no hay nada que esperar
      if (!headerRTM) {
        clearInterval(interval);
        resolve();
        return;
      }

      // Comprobar si ya apareció la fecha
      const fechaDisponible = document.querySelector(selectorFecha);

      // Comprobar si el RUNT respondió que no hay información
      const panel = headerRTM.closest('mat-expansion-panel');

      const mensajeSinRTM = panel
        ?.querySelector('.mat-expansion-panel-content')
        ?.textContent?.includes(
          'No se encontró información registrada en el RUNT',
        );

      if (fechaDisponible || mensajeSinRTM) {
        clearInterval(interval);
        resolve();
        return;
      }

      if (Date.now() - start >= timeout) {
        clearInterval(interval);

        reject(new Error('El panel RTM no terminó de cargar a tiempo.'));
      }
    }, 200);
  });
}

function waitForElement(
  selector: string,
  timeout = 8000,
): Promise<HTMLElement> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const interval = setInterval(() => {
      const el = document.querySelector<HTMLElement>(selector);
      if (el) {
        clearInterval(interval);
        resolve(el);
        return;
      }
      if (Date.now() - start >= timeout) {
        clearInterval(interval);
        reject(new Error(`No apareció el elemento: ${selector}`));
      }
    }, 200);
  });
}

// Función auxiliar para obtener el texto de un selector
const getText = (selector: string): string => {
  return document.querySelector(selector)?.textContent?.trim() || '';
};
function waitForRuntResponse(
  placa: string,
  maxWait = 20000,
): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const checkInterval = 300;
    const start = Date.now();
    const placaBuscada = placa.trim().toUpperCase();

    const interval = setInterval(() => {
      // 1. Comprobar si el RUNT respondió con un error
      const popup = document.querySelector(
        '.swal2-popup.swal2-modal.swal2-icon-error',
      );

      if (popup) {
        clearInterval(interval);

        const message =
          popup.querySelector('.swal2-html-container')?.textContent?.trim() ||
          'El RUNT reportó un error.';

        resolve(message);
        return;
      }

      // 2. Comprobar que existen los desplegables
      const desplegables = document.querySelector('mat-expansion-panel-header');

      // 3. Comprobar que la placa aparece en los resultados
      const placaVisible = document.body.innerText
        .toUpperCase()
        .includes(placaBuscada);

      if (desplegables && placaVisible) {
        clearInterval(interval);
        resolve(null);
        return;
      }

      // 4. Tiempo máximo de espera
      if (Date.now() - start >= maxWait) {
        clearInterval(interval);

        reject(
          new Error(
            `El RUNT no terminó de cargar los resultados para la placa ${placa}.`,
          ),
        );
      }
    }, checkInterval);
  });
}

function setAngularInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set;

  setter?.call(input, value);

  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.dispatchEvent(new Event('blur', { bubbles: true }));
}

function clickElement(el: HTMLElement) {
  el.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true, view: window }),
  );
}

export default defineContentScript({
  matches: ['https://portalpublico.runt.gov.co/*'],
  runAt: 'document_idle',

  main() {
    console.log('[RUNT Extension] Content Script activo', location.href);

    // =====================================================
    // 1. CAPTCHA
    // =====================================================
    const captchaSelector = 'div.col-md-12 > img.img-responsive.img-fluid';
    const interval = 500;
    const timeout = 20000;
    const startTime = Date.now();

    const searchCaptcha = async () => {
      const images =
        document.querySelectorAll<HTMLImageElement>(captchaSelector);
      console.log('[RUNT] searchCaptcha, imágenes:', images.length);

      const captcha = Array.from(images).find((img) =>
        img.src.startsWith('data:image/png;base64,'),
      );

      if (captcha) {
        clearInterval(searchInterval);
        console.log('[RUNT] CAPTCHA encontrado, enviando CAPTCHA_READY');

        await browser.runtime.sendMessage({
          type: 'CAPTCHA_READY',
          captcha: captcha.src,
        });

        console.log('[RUNT] CAPTCHA_READY enviado');
        return;
      }

      if (Date.now() - startTime >= timeout) {
        clearInterval(searchInterval);
        console.error('[RUNT] CAPTCHA no encontrado');
        await browser.runtime.sendMessage({
          type: 'CAPTCHA_ERROR',
          message: 'No se encontró el CAPTCHA después de 20 segundos.',
        });
      }
    };

    const searchInterval = setInterval(searchCaptcha, interval);
    void searchCaptcha();

    // =====================================================
    // 2. SOLVE_CAPTCHA (inyección + extracción)
    // =====================================================
    browser.runtime.onMessage.addListener(async (message: unknown) => {
      if (!message || typeof message !== 'object') return;
      if ((message as { type?: string }).type !== 'SOLVE_CAPTCHA') return;

      const req = message as SolveCaptchaMessage;
      console.log('[RUNT] SOLVE_CAPTCHA recibido:', req.requestId);

      try {
        // PLACA
        const inputPlaca =
          document.querySelector<HTMLInputElement>('#mat-input-0');
        if (!inputPlaca) throw new Error('No se encontró el input de placa.');
        setAngularInput(inputPlaca, (req.placa ?? '').toUpperCase());

        // TIPO DE DOCUMENTO
        const selectTrigger =
          document.querySelector<HTMLElement>('#mat-select-4');
        if (!selectTrigger)
          throw new Error('No se encontró el select de tipo de documento.');
        clickElement(selectTrigger);
        await new Promise((r) => setTimeout(r, 300));

        const textoDocumento =
          MAPEO_DOCUMENTOS[req.tipoDocumento ?? ''] || 'Cédula Ciudadanía';

        const opciones = Array.from(
          document.querySelectorAll<HTMLElement>('mat-option'),
        );
        const opcion = opciones.find(
          (o) => o.textContent?.trim() === textoDocumento,
        );
        if (!opcion)
          throw new Error(
            `No se encontró la opción de documento: ${textoDocumento}`,
          );
        clickElement(opcion);
        await new Promise((r) => setTimeout(r, 300));

        // NÚMERO DE DOCUMENTO
        const inputNumDoc =
          document.querySelector<HTMLInputElement>('#mat-input-1');
        if (!inputNumDoc)
          throw new Error('No se encontró el input de número de documento.');
        setAngularInput(inputNumDoc, req.numeroDocumento ?? '');

        // CAPTCHA
        const inputCaptcha =
          document.querySelector<HTMLInputElement>('#mat-input-2');
        if (!inputCaptcha)
          throw new Error('No se encontró el input de captcha.');
        setAngularInput(inputCaptcha, req.captchaValue ?? '');

        // BOTÓN CONSULTAR
        const botonConsultar = Array.from(
          document.querySelectorAll<HTMLElement>('button'),
        ).find(
          (b) =>
            b.textContent?.trim().toLowerCase() === 'consultar' ||
            b.getAttribute('type') === 'submit',
        );
        if (!botonConsultar)
          throw new Error('No se encontró el botón Consultar.');
        clickElement(botonConsultar);

        console.log('[RUNT] Formulario enviado. Esperando datos...');

        // Esperamos a ver si el RUNT muestra el diálogo de error
        const errorMessage = await waitForRuntResponse(req.placa ?? '');

        if (errorMessage) {
          // ❌ El RUNT rechazó la consulta (captcha mal, datos no coinciden...)
          await browser.runtime.sendMessage({
            type: 'DATA_ERROR',
            requestId: req.requestId,
            message: errorMessage,
          });

          console.log('[RUNT] DATA_ERROR enviado:', errorMessage);
          return;
        }

        // ==========================================
        // ABRIR DESPLEGABLES
        // ==========================================

        // 1. SOAT
        const headerSoat = Array.from(
          document.querySelectorAll<HTMLElement>(
            'mat-expansion-panel-header, mat-panel-title',
          ),
        ).find((el) => el.textContent?.includes('SOAT'));

        if (!headerSoat) throw new Error('No se encontró el panel SOAT.');

        clickElement(headerSoat);

        // 2. DATOS TÉCNICOS
        const panelDatosTecnicos = document.querySelector<HTMLElement>(
          'div.mt-4:nth-child(3)',
        );

        if (!panelDatosTecnicos)
          throw new Error('No se encontró el panel de datos técnicos.');

        const headerDatosTecnicos =
          panelDatosTecnicos.querySelector<HTMLElement>(
            'mat-expansion-panel-header',
          );

        if (!headerDatosTecnicos)
          throw new Error('El panel de datos técnicos no tiene header.');

        clickElement(headerDatosTecnicos);

        // 3. RTM
        const panelRTM = document.querySelector<HTMLElement>(
          'div.mt-4:nth-child(5)',
        );

        if (panelRTM) {
          const headerRTM = panelRTM.querySelector<HTMLElement>(
            'mat-expansion-panel-header',
          );

          if (headerRTM) {
            clickElement(headerRTM);
          } else {
            console.log('[RUNT] Panel RTM sin header.');
          }
        } else {
          console.log('[RUNT] Vehículo sin panel RTM, se continúa.');
        }

        // TODO: extracción real. Por ahora payload vacío.

        // ======================================================
        // DATOS GENERALES DEL VEHÍCULO
        // ======================================================

        const selectorServicio =
          'body > host-runt-root > app-layout > app-theme-runt2 > mat-sidenav-container > mat-sidenav-content > div > ng-component > div > div > div:nth-child(2) > div:nth-child(2) > cyrconsultavehiculo-info-vehiculo-detallada > div > div:nth-child(1) > div.panel-content > div > div > div:nth-child(3) > div:nth-child(2) > b';

        let tipoServicio = getText(selectorServicio).toLowerCase();

        if (tipoServicio === 'público') {
          tipoServicio = 'publico';
        }

        // ======================================================
        // CLASE DEL VEHÍCULO
        // ======================================================

        const claseVehiculo = getText(
          'div.panel-soat:nth-child(1) > div:nth-child(2) > div:nth-child(1) > div:nth-child(1) > div:nth-child(3) > div:nth-child(4) > b:nth-child(1)',
        ).toLowerCase();

        // ======================================================
        // SOAT
        // ======================================================

        const selectorFechaSOAT =
          '#cdk-accordion-child-1 mat-cell.cdk-column-fechaFinVigencia';

        await waitForElement(selectorFechaSOAT, 5000);

        const soatRaw = getText(selectorFechaSOAT);

        console.log('🔎 DIAGNÓSTICO SOAT:', {
          soatRaw,
        });

        let soatFormateado = '';

        if (soatRaw.includes('/')) {
          const [dia, mes, anio] = soatRaw.split('/');
          soatFormateado = `${anio}-${mes}-${dia}`;
        }

        const soatVigenteRaw = getText(
          '#cdk-accordion-child-1 > div > mat-card-content > div > mat-table > mat-row:nth-child(2) > mat-cell.mat-cell.cdk-cell.cdk-column-estado.mat-column-estado.ng-star-inserted',
        );

        const SOATvigenteDeAcuerdoAlRUNTformateado = soatVigenteRaw
          .replace(/cancel|check_circle/gi, '')
          .replace(/\s+/g, ' ')
          .trim()
          .toUpperCase();

        // ======================================================
        // MARCA
        // ======================================================

        const marcaVehiculo = getText(
          'div.panel-soat:nth-child(2) > div:nth-child(1) > div:nth-child(2) > div:nth-child(1) > div:nth-child(1) > div:nth-child(2) > b:nth-child(1)',
        );

        // ======================================================
        // LÍNEA
        // ======================================================

        const lineaVehiculo = getText(
          'div.panel-soat:nth-child(2) > div:nth-child(1) > div:nth-child(2) > div:nth-child(1) > div:nth-child(1) > div:nth-child(4) > b:nth-child(1)',
        );

        // ======================================================
        // MODELO
        // ======================================================

        const modeloVehiculo = getText(
          'div.panel-soat:nth-child(2) > div:nth-child(1) > div:nth-child(2) > div:nth-child(1) > div:nth-child(2) > div:nth-child(2) > b:nth-child(1)',
        );

        // ======================================================
        // COLOR
        // ======================================================

        const colorVehiculo = getText(
          'div.panel-soat:nth-child(2) > div:nth-child(1) > div:nth-child(2) > div:nth-child(1) > div:nth-child(2) > div:nth-child(4) > b:nth-child(1)',
        );

        // ======================================================
        // CILINDRADA
        // ======================================================

        const cilindradaVehiculo = getText(
          'div.row:nth-child(5) > div:nth-child(2) > b:nth-child(1)',
        );

        // ======================================================
        // COMBUSTIBLE
        // ======================================================

        const combustibleVehiculo = getText(
          'div.row:nth-child(6) > div:nth-child(2) > b:nth-child(1)',
        ).toLowerCase();

        // ======================================================
        // VEHÍCULO DE ENSEÑANZA
        // ======================================================

        const ensenanzaVehiculo = combustibleVehiculo.trim() === 'si';

        // ======================================================
        // CAPACIDAD DE PASAJEROS
        // ======================================================
        const selectorCapacidadPasajeros =
          'div.panel-content:nth-child(1) > div:nth-child(2) > div:nth-child(4) > b:nth-child(1)';

        await waitForElement(selectorCapacidadPasajeros, 5000);
        const capacidadPasajeros = getText(
          'div.panel-content:nth-child(1) > div:nth-child(2) > div:nth-child(4) > b:nth-child(1)',
        );

        // ======================================================
        // FECHA DE MATRÍCULA
        // ======================================================

        const selectorFechaMatricula =
          'body > host-runt-root > app-layout > app-theme-runt2 > mat-sidenav-container > mat-sidenav-content > div > ng-component > div > div > div:nth-child(2) > div:nth-child(2) > cyrconsultavehiculo-info-vehiculo-detallada > div > div:nth-child(2) > div > div.panel-content > div.col-lg-12 > div:nth-child(6) > div.col-xs-12.col-md-3.col-sm-3.show-grande.td-icon-date > b';

        const fechaMatriculaRaw = getText(selectorFechaMatricula);

        let fechaMatriculaFormateado = '';

        if (fechaMatriculaRaw.includes('/')) {
          const [dia, mes, anio] = fechaMatriculaRaw.split('/');
          fechaMatriculaFormateado = `${anio}-${mes}-${dia}`;
        }

        // ======================================================
        // RTM
        // ======================================================

        const selectorFechaDeVencimiento =
          '#cdk-accordion-child-2 > div > mat-card-content > div > div > mat-table > mat-row:nth-child(2) > mat-cell.mat-cell.cdk-cell.cdk-column-fechaVigencia.mat-column-fechaVigencia.ng-star-inserted';

        const selectorOrganismoQueExpidioUltimaRTM =
          '#cdk-accordion-child-2 > div > mat-card-content > div > div > mat-table > mat-row:nth-child(2) > mat-cell.mat-cell.cdk-cell.cdk-column-nombreCda.mat-column-nombreCda.ng-star-inserted';

        const selectorVigenteRTMenelRunt =
          '#cdk-accordion-child-2 > div > mat-card-content > div > div > mat-table > mat-row:nth-child(2) > mat-cell.mat-cell.cdk-cell.cdk-column-vigente.mat-column-vigente.ng-star-inserted';

        await waitForRTM(selectorFechaDeVencimiento, 5000);

        const fechaVencimientoRTMRaw = getText(selectorFechaDeVencimiento);

        let fechaVencimientoRTMFormateado = '';

        if (fechaVencimientoRTMRaw.includes('/')) {
          const [dia, mes, anio] = fechaVencimientoRTMRaw.split('/');
          fechaVencimientoRTMFormateado = `${anio}-${mes}-${dia}`;
        }

        const organismoQueExpidioUltimaRTM = getText(
          selectorOrganismoQueExpidioUltimaRTM,
        );

        const vigenteRTMenelRunt = getText(selectorVigenteRTMenelRunt);

        const seEncontroFechaRTMenRUNT = fechaVencimientoRTMRaw ? 'SI' : 'NO';

        // ======================================================
        // CONSOLA: RESULTADO DE LA EXTRACCIÓN
        // ======================================================
        const datosVehiculo = {
          tipo_servicio: tipoServicio,
          clase_vehiculo: claseVehiculo,
          soat: soatFormateado,
          marca_vehiculo: marcaVehiculo,
          lineaVehiculo,
          modelo_vehiculo: modeloVehiculo,
          color_vehiculo: colorVehiculo,
          cilindrada_vehiculo: cilindradaVehiculo,
          combustible_vehiculo: combustibleVehiculo,
          es_ensenanza: ensenanzaVehiculo,
          capacidad_pasajeros: capacidadPasajeros,
          se_encontro_fecha_vencimiento_RTM: seEncontroFechaRTMenRUNT,
          fecha_vencimiento_RTM: fechaVencimientoRTMFormateado,
          organismo_que_expidio_la_ultima_RTM: organismoQueExpidioUltimaRTM,
          RTM_vigente_de_acuerdo_al_runt: vigenteRTMenelRunt,
          fecha_matricula: fechaMatriculaFormateado,
          SOAT_vigente_de_acuerdo_al_RUNT: SOATvigenteDeAcuerdoAlRUNTformateado,
        };

        console.log('📦 DATOS EXTRAÍDOS DEL RUNT:', datosVehiculo);

        await browser.runtime.sendMessage({
          type: 'DATA_READY',
          requestId: req.requestId,
          payload: {
            ...datosVehiculo,
          },
        });

        console.log('[RUNT] DATA_READY enviado (payload vacío)');
      } catch (error) {
        console.error('[RUNT] Error en SOLVE_CAPTCHA:', error);
        await browser.runtime.sendMessage({
          type: 'DATA_ERROR',
          requestId: req.requestId,
          message:
            error instanceof Error
              ? error.message
              : 'Error al inyectar el formulario del RUNT.',
        });
      }
    });
  },
});
