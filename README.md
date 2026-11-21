# WXT + React

This template should help get you started developing with React in WXT.

"scripts": {
// Inicia el servidor de desarrollo de WXT.
"dev": "wxt",

// Inicia el entorno de desarrollo para Firefox.
"dev:firefox": "wxt -b firefox",

// Genera la compilación de producción.
"build": "wxt build",

// Genera la compilación de producción para Firefox.
"build:firefox": "wxt build -b firefox",

// Empaqueta la extensión en un archivo ZIP.
"zip": "wxt zip",

// Empaqueta la extensión para Firefox.
"zip:firefox": "wxt zip -b firefox",

// Comprueba los tipos de TypeScript sin generar archivos.
"compile": "tsc --noEmit",

// Analiza el código y detecta posibles errores.
"lint": "eslint .",

// Corrige automáticamente los problemas que ESLint pueda resolver.
"lint:fix": "eslint . --fix",

// Aplica el formato de Prettier a los archivos.
"format": "prettier --write .",

// Comprueba el formato sin modificar los archivos.
"format:check": "prettier --check .",

// Prepara los archivos y tipos necesarios de WXT tras instalar dependencias.
"postinstall": "wxt prepare"
}

## Arquitectura

entrypoints/
├── background.ts
├── content.ts
└── popup/
├── App.tsx
├── App.css
├── main.tsx
└── index.html

components/
hooks/
lib/
services/
types/
utils/

La idea es que:

- entrypoints: puntos de entrada de la extensión.
- components: componentes reutilizables de React.
- hooks: hooks personalizados.
- lib: configuraciones y funcionalidades compartidas.
- services: comunicación y servicios externos.
- types: interfaces y tipos de TypeScript.
- utils: funciones auxiliares.

## Flujo

El flujo sería:

1. El recepcionista abre el modal de RUNT en cdApp.
2. TanStack Query solicita a la extensión iniciar una consulta.
3. La extensión abre una pestaña del RUNT y espera a que cargue el CAPTCHA.
4. La extensión devuelve la imagen del CAPTCHA a cdApp.
5. El recepcionista escribe el CAPTCHA y confirma los datos del propietario.
6. cdApp envía esos datos a la extensión.
7. La extensión completa el formulario del RUNT, consulta y extrae la información.
8. La extensión devuelve el payload con la misma estructura que tienes actualmente.
9. Tu componente actualiza formData y el recepcionista continúa diligenciando la orden.
10. El guardado final sigue utilizando exactamente el mismo RPC.
