/**
 * Отделяет расчёт карты от UI-потока.
 * Основа сохраняется между запросами, а накопившиеся изменения сворачиваются в последнюю регенерацию.
 * Идентификатор ответа позволяет хранилищу отклонить устаревший результат.
 */
import { applyTemplate } from "./template-engine.js";
let surface = null,
  timer;
self.onmessage = ({ data }) => {
  if (data.surface) surface = data.surface;
  clearTimeout(timer);
  // События, накопившиеся за расчёт, сворачиваются в последнюю регенерацию.
  timer = setTimeout(() => {
    try {
      self.postMessage({
        id: data.id,
        applied: applyTemplate(data.template, data.parameters, surface),
      });
    } catch (error) {
      self.postMessage({ id: data.id, error: error.message });
    }
  }, 40);
};
