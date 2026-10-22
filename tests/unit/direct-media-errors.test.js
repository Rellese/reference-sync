import test from 'node:test';import assert from 'node:assert/strict';
import {directMediaErrorReason} from '../../js/sources/direct-media-errors.js';
for(const [error,stage,reason] of [[Error('HTTP 403'),'download','Сервер медиа вернул HTTP 403.'],[Object.assign(Error('private'),{code:'ERR_INVALID_ARG_TYPE'}),'download','Ошибка загрузчика (ERR_INVALID_ARG_TYPE).'],[Error('MEDIA_INVALID_CONTENT'),'download','Вместо медиа сервер вернул страницу или JSON.'],[Object.assign(Error('secret'),{code:'CERT_HAS_EXPIRED'}),'download','Не удалось проверить сертификат сервера медиа.'],[Error('https://cdn.example/video?token=private /private/path'),'validation','Проверка скачанного видео не пройдена.'],[Error('Cookie: private-secret'),'download','Неизвестная ошибка загрузчика.']])test('safe direct media reason '+reason,()=>{assert.equal(directMediaErrorReason(error,stage),reason);});
test('unknown codes and object-prototype names cannot escape the safe reason list',()=>{
 for(const value of ['constructor','toString','__proto__'])assert.equal(directMediaErrorReason({message:value,code:'PRIVATE_TOKEN'},'download'),'Неизвестная ошибка загрузчика.');
});
test('per-component errors translate both the wrapper and safe reason',async()=>{
 const {translate}=await import('../../js/i18n.js');
 const text='Не удалось скачать компонент Layers. Ошибка загрузчика (ERR_INVALID_ARG_TYPE). Повторите загрузку публикации.';
 assert.equal(translate(text,'en'),'Could not download Layers media. Download engine error (ERR_INVALID_ARG_TYPE). Download the post again.');
 assert.equal(translate('Компонент 1: Сервер медиа вернул HTTP 403.','en'),'Component 1: The media server returned HTTP 403.');
});
