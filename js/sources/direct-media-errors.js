// Only fixed reasons/codes are exposed. Raw request/FFmpeg errors may contain
// signed URLs, headers, paths or response data and must never reach the log.
export function directMediaErrorReason(error,stage){
 const http=/^HTTP (\d{3})$/.exec(String(error?.message||''));
 if(http)return `Сервер медиа вернул HTTP ${http[1]}.`;
 const reasons={MEDIA_HTTPS_REQUIRED:'Адрес медиа должен использовать HTTPS.',
  MEDIA_REDIRECT_LIMIT:'Слишком много перенаправлений медиа.',
  MEDIA_INVALID_CONTENT:'Вместо медиа сервер вернул страницу или JSON.',
  MEDIA_INCOMPLETE:'Сервер вернул неполный файл.',
  LAYERS_MEDIA_URL:'Сайт вернул неподдерживаемый адрес медиа.',
  THREADS_MEDIA_URL:'Сайт вернул неподдерживаемый адрес медиа.',
  DRIBBBLE_MEDIA_URL:'Сайт вернул неподдерживаемый адрес медиа.',
  X_MEDIA_URL:'Сайт вернул неподдерживаемый адрес медиа.'};
 if(Object.prototype.hasOwnProperty.call(reasons,error?.message))return reasons[error.message];
 const code=String(error?.code||'');
 if(['ERR_INVALID_ARG_TYPE','ERR_INVALID_PROTOCOL','ERR_INVALID_URL','ERR_STREAM_PREMATURE_CLOSE'].includes(code))return `Ошибка загрузчика (${code}).`;
 if(['CERT_HAS_EXPIRED','DEPTH_ZERO_SELF_SIGNED_CERT','SELF_SIGNED_CERT_IN_CHAIN','UNABLE_TO_VERIFY_LEAF_SIGNATURE','UNABLE_TO_GET_ISSUER_CERT_LOCALLY'].includes(code))return 'Не удалось проверить сертификат сервера медиа.';
 return stage==='validation'?'Проверка скачанного видео не пройдена.':'Неизвестная ошибка загрузчика.';
}
