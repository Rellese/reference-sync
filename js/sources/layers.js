/* Layers.to — витрина интерфейсов. gallery-dl этот сайт пока не
   поддерживает, поэтому источник объявлен как заготовка: кнопка
   в блоке 2 будет видна, но заблокирована с понятной причиной.
   Когда поддержка появится — достаточно поставить ready: true. */
import { createGallerySource } from './gallery-source.js';

export default createGallerySource({
  code: 'layers',
  title: 'Layers.to',
  icon: 'layers',
  ready: false,
  notReadyReason: 'Layers.to пока не поддерживается движком загрузки. '
    + 'Подключим, как только появится поддержка.',
  containerTypes: ['ROOT', 'ACCOUNT', 'COLLECTION'],
  containerLabels: { root: 'Все работы', level1: 'Аккаунт', level2: 'Подборка' },
  defaultTags: ['Layers'],
  nameMarker: 'layorder',
  jobPrefix: 'layers',
  cookies: true,
  urlPattern: /(?:^|\/\/)(?:www\.)?layers\.to\//i,
  groupBy: 'file',
  buildTargets({ username }) {
    return [{ id: 'works', name: 'Все работы', url: `https://layers.to/${username}` }];
  },
});
