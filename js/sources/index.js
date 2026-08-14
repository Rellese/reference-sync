/* ============================================================
   Подключение источников — единственное место, где перечислены
   все соцсети. Порядок здесь = порядок кнопок в блоке 2.

   Чтобы добавить новую соцсеть:
     1. создать js/sources/<код>.js (обычно 30 строк на
        createGallerySource);
     2. добавить импорт и строку registerSource ниже;
     3. положить иконку в assets/icons/<код>.svg.
   Больше ничего менять не нужно.
   ============================================================ */

import { registerSource, listSources } from './registry.js';
import instagram from './instagram.js';
import pinterest from './pinterest.js';
import dribbble from './dribbble.js';
import behance from './behance.js';
import vimeo from './vimeo.js';
import x from './x.js';
import layers from './layers.js';

const ALL = [instagram, pinterest, dribbble, behance, vimeo, x, layers];

let installed = false;

/* Идемпотентно: повторный вызов ничего не ломает */
export function installSources() {
  if (installed) return listSources();
  ALL.forEach((descriptor) => registerSource(descriptor));
  installed = true;
  return listSources();
}

export * from './registry.js';
