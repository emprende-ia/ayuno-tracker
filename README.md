# Ayuno 16:8

**Abrir la app:** https://emprende-ia.github.io/ayuno-tracker/

Web app para registrar un ayuno 16:8 sin cena, con un ayuno intenso semanal, rachas y protectores. Diseñada con Material Design 3 Expressive, en modo claro y oscuro. Es un sitio estático (HTML, CSS y JavaScript sin dependencias), listo para GitHub Pages y para instalarse en el teléfono como app.

## El plan

| Día | Qué haces | Ayuno |
|---|---|---|
| Lunes a jueves | Comes de 06:00 a 14:00 y no cenas | 14:00 → 06:00 (16 h) |
| Viernes a sábado | Comes a las 14:00 el viernes y rompes con la cena del sábado | Vie 14:00 → Sáb 20:00 (30 h) |
| Domingo | Descanso, comes libre | Sin meta |

Total: 94 h de ayuno por semana.

Si un día terminas de comer más tarde, toca **Ajustar mi última comida** y el ayuno se recorre a esa hora (dura lo mismo).

## Cómo se cuenta

- **Registro:** cada ayuno cuenta para el día en que no cenas. Lo marcas con **Sí ayuné** o **No ayuné**, esa noche o a la mañana siguiente.
- **Racha diaria:** suma un día por cada día con meta cumplido. «No ayuné» la reinicia. El domingo no suma ni corta.
- **Días sin registrar:** hoy y el día con meta anterior tienen margen. Un día más viejo sin registrar corta la racha hasta que lo registres; al corregirlo, la racha se recalcula sola.
- **Protectores:** máximo 2, empiezas con 1. Ganas 1 por cada semana perfecta (6 de 6 sin protector). Al marcar «No ayuné» puedes usar uno: el día queda registrado tal cual y la racha se conserva, sin sumar.
- **Semana:** se completa con los 6 días con meta cumplidos o protegidos. Las semanas completas seguidas forman la racha semanal. Si empiezas a mitad de semana, esa primera semana es parcial y no cuenta para la racha semanal.

## Publicar en GitHub Pages

1. Crea un repositorio nuevo en GitHub, por ejemplo `ayuno-tracker`.
2. Sube el contenido de esta carpeta a la rama `main`:

   ```bash
   cd ayuno-tracker
   git init
   git add .
   git commit -m "Ayuno 16:8"
   git branch -M main
   git remote add origin https://github.com/TU_USUARIO/ayuno-tracker.git
   git push -u origin main
   ```

   También puedes arrastrar los archivos en GitHub con **Add file → Upload files**.
3. En el repositorio entra a **Settings → Pages**. En **Build and deployment** elige **Deploy from a branch**, rama `main` y carpeta `/ (root)`. Guarda.
4. En uno o dos minutos la app queda en `https://TU_USUARIO.github.io/ayuno-tracker/`.

### Instalar en el teléfono

- **Android (Chrome):** abre la URL y toca **Instalar app** o menú ⋮ → **Agregar a la pantalla principal**.
- **iPhone (Safari):** botón Compartir → **Agregar a inicio**.

Después de la primera visita funciona sin conexión.

## Tus datos

Los registros se guardan solo en el navegador de tu dispositivo (`localStorage`). No hay servidor ni cuentas. Desde **Ajustes** puedes:

- **Exportar copia:** descarga un `.json` con todo tu historial.
- **Importar copia:** restaura ese archivo en otro teléfono o navegador.
- **Inicio del registro:** cambia la fecha desde la que cuentan tus rachas.

Si borras los datos del navegador o desinstalas la app, se pierde el historial; exporta una copia de vez en cuando.

## Desarrollo local

```bash
npm start          # sirve en http://localhost:8080 (usa Python 3)
npm test           # pruebas de horario y rachas (Node 20+)
```

Los módulos ES necesitan servirse por HTTP; abrir `index.html` con doble clic no funciona.

Cuando publiques cambios, sube el número en `VERSION` dentro de `sw.js` para que los teléfonos descarguen la versión nueva.

## Estructura

```
index.html              Estructura de la app
css/tokens.css          Colores M3 (claro y oscuro) generados desde la semilla verde #2E7D32
css/app.css             Componentes, formas, movimiento y diseño adaptable
js/schedule.js          Horario del plan y fase actual (ayuno, ventana, intenso, descanso)
js/streaks.js           Rachas, semanas y protectores calculados desde los registros
js/store.js             Guardado local y copias de respaldo
js/shapes.js            Indicador circular ondulado y formas festoneadas
js/app.js               Interfaz y eventos
sw.js                   Funcionamiento sin conexión
manifest.webmanifest    Datos para instalar la app
tests/logic.test.mjs    Pruebas de la lógica
```

### Cambiar los colores

`css/tokens.css` se generó con [`@material/material-color-utilities`](https://github.com/material-foundation/material-color-utilities) (especificación 2025, esquema Fidelity) a partir del color semilla verde `#2E7D32`. Para otro tono, genera los roles con esa librería o con [Material Theme Builder](https://material-foundation.github.io/material-theme-builder/) y reemplaza las variables `--md-sys-color-*`.

### Cambiar el horario

Los horarios viven en `PLAN` dentro de `js/schedule.js` (`lastMeal`, `windowOpens`, `fastHours`, `intenseHours`). Los días de cada tipo están en `dayKind()` y `fastFor()`.

## Nota de salud

Para el ayuno de 30 h ayuda tomar agua, café o té sin azúcar y algo de sal o electrolitos. Si tomas medicamento para la glucosa o la presión, consúltalo con tu médico.

## Licencia

MIT
