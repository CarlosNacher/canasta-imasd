# Canasta de I+D

Web para llevar el juego de la canasta del departamento: tabla del mes, verificación de aciertos, notificaciones, premios con el reparto del almuerzo y gestión de usuarios.

La web es estática (se aloja gratis en **GitHub Pages**) y guarda los datos y las cuentas en **Firebase** (plan gratuito Spark, de sobra para un departamento).

## Estructura

```
index.html          Página + textos de la pestaña Info (reglas y fórmula)
styles.css          Estilos (modo claro y oscuro)
js/app.js           Lógica de la web
js/payout.js        Fórmula del reparto del almuerzo
js/firebase-config.js  ← aquí pegas tu configuración de Firebase
firestore.rules     Reglas de seguridad de la base de datos
```

## 1. Crear el proyecto de Firebase (10 minutos)

1. Entra en <https://console.firebase.google.com> y pulsa **Crear proyecto** (puedes desactivar Google Analytics).
2. **Authentication → Comenzar → Método de inicio de sesión → Correo electrónico/contraseña → Habilitar**.
3. **Firestore Database → Crear base de datos** → modo producción → elige una ubicación europea (p. ej. `europe-west1`).
4. En Firestore, pestaña **Reglas**: borra lo que haya, pega el contenido de `firestore.rules` y pulsa **Publicar**.
5. **Configuración del proyecto (⚙️) → Tus apps → icono `</>` (Web)**. Ponle un nombre y registra la app (no hace falta Firebase Hosting). Copia el objeto `firebaseConfig` que te muestra y pégalo en `js/firebase-config.js`.

> La configuración de Firebase no es secreta: puede estar en un repositorio público. Lo que protege los datos son las reglas de `firestore.rules`.

## 2. Publicar en GitHub Pages

1. Crea un repositorio en GitHub (p. ej. `canasta`) y sube todos los archivos, respetando la carpeta `js/`.
   ```bash
   git init
   git add .
   git commit -m "Canasta de I+D"
   git branch -M main
   git remote add origin https://github.com/TU-USUARIO/canasta.git
   git push -u origin main
   ```
2. En el repositorio: **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main` / `(root)` → Save**.
3. En un minuto la web estará en `https://TU-USUARIO.github.io/canasta/`.
4. En Firebase: **Authentication → Configuración → Dominios autorizados → Agregar dominio** → `TU-USUARIO.github.io`.

## 3. Primer uso

1. Abre la web. Como la base de datos está vacía, te pedirá **crear la cuenta de administrador**.
2. En la pestaña **Usuarios**, da de alta al resto del equipo con su correo y una contraseña inicial. Cada persona puede cambiar su contraseña y su foto desde esa misma pestaña.
3. Si alguien olvida la contraseña, en la pantalla de entrada tiene el enlace **He olvidado la contraseña**, que le envía un correo para cambiarla (por eso conviene usar correos reales, como el de la empresa).

## Cómo funciona

- **Vista general**: tabla del mes en curso (con flechas para ver meses anteriores). Filas = jugadores, columnas = días.
  - Tic verde: acierto verificado · Tic gris: acierto sin verificar · Cruz roja: fallo · Círculo azul: no tirado (días pasados sin anotación) · La etiqueta naranja **5** indica acierto con el pie.
  - Columna **\*** tras el último día: muerte súbita (solo tienen datos los candidatos al primer puesto).
  - Debajo, el **historial** del mes con quién verificó cada acierto y cuándo.
- **Verificación**: un acierto suma solo cuando otra persona lo verifica (desde la casilla o desde Notificaciones). Nadie puede verificar sus propios tiros, y un tiro verificado ya no se puede cambiar (salvo un administrador).
- **Notificaciones**: aciertos de compañeros por verificar, lo que debes, lo que te deben y las muertes súbitas en las que participas. El número junto a la pestaña cuenta lo que requiere acción.
- **Premios**: un desplegable por mes con el ganador, la clasificación, cuánto paga cada uno y si ya ha pagado.
  - Al acabar un mes, un administrador pulsa **Cerrar mes y fijar pagos** (si hay empate en cabeza, primero se juega y se anota la muerte súbita). Cerrar congela la clasificación: ya no se pueden anotar ni verificar tiros de ese mes. Un admin puede **reabrir** el mes si hay que corregir algo.
  - El ganador del mes (o un admin) marca quién le ha pagado.
- **Moroso**: si un pago de un mes cerrado sigue pendiente más de un mes después del cierre (es decir, a partir del segundo mes siguiente), aparece un cartel de **Moroso** sobre la foto de esa persona en toda la web.
- **Usuarios**: perfil y contraseña propios; los administradores dan de alta, nombran otros administradores y desactivan cuentas (los datos de una cuenta desactivada se conservan).

## Ajustes

- **Reglas (pestaña Info)**: edita el bloque `<template id="tpl-info">` de `index.html`.
- **Fórmula**: el texto está en `<template id="tpl-formula">` de `index.html`; el cálculo, en `js/payout.js` (el precio del almuerzo es la constante `PREMIO`).
- **Quién participa en el reparto**: `SOLO_CON_TIROS` en `js/firebase-config.js`. Con `false` (por defecto) participan todos los usuarios activos; con `true`, solo quien haya anotado al menos un tiro ese mes.

## Datos en Firestore

| Colección     | Documento     | Contenido |
|---------------|---------------|-----------|
| `usuarios`    | uid           | nombre, email, foto (miniatura), admin, activo |
| `tiros`       | `AAAA-MM-DD_uid` | resultado (`acierto`/`fallo`), tipo (`mano`/`pie`), verificadoPor, verificadoEn |
| `desempates`  | `AAAA-MM`     | candidatos, rondas de muerte súbita, ganador |
| `pagos`       | `AAAA-MM`     | mes cerrado: clasificación, importes y estado de pago |
| `config`      | `app`         | mes de inicio |
