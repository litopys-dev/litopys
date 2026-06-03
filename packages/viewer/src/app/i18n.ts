// ---------------------------------------------------------------------------
// Minimal i18n layer
//
// A flat RU dictionary + a `t()` helper with {param} interpolation, plus two
// glossaries (relation labels with explanations, node-type labels). No external
// dependency: two locales without plural/interpolation libraries are ~30 lines.
//
// Default and only locale today is Russian. The structure is intentionally
// shaped so a second locale + a switcher can be added later without touching
// any `t()` call site — drop in an `en` dict and resolve `dicts[locale]`.
// ---------------------------------------------------------------------------

import type { NodeType, RefOrigin, RelationName } from "./api.ts";

type Params = Record<string, string | number>;

const ru: Record<string, string> = {
  // Quarantine page
  "q.title": "Карантин",
  "q.subtitle":
    "Кандидаты от экстрактора ждут проверки. Принять — добавить в граф, отклонить — выбросить.",
  "q.empty": "Нет кандидатов на проверку.",
  "q.loadError": "Ошибка загрузки карантина: {msg}",
  "q.accepted": "Принят кандидат {id}",
  "q.rejected": "Отклонён кандидат {id}",
  "q.rejectPrompt": "Причина отклонения «{id}» (необязательно):",
  "q.reject": "Отклонить",
  "q.accept": "Принять",
  "q.why": "Почему экстрактор это предложил",
  "q.confidence": "уверенность",
  "q.relations": "Связи",

  // Merge proposal
  "merge.proposal": "Предложение объединить",
  "merge.detectedBy": "обнаружено: {by}",
  "merge.loser": "Поглощается",
  "merge.winner": "Остаётся",
  "merge.accept": "Объединить",
  "merge.confirm":
    "Применить объединение?\n\n{loser} → {winner}\n\nПоглощаемый узел будет помечен как устаревший, а оставшийся вберёт его псевдонимы, теги и связи.",
  "merge.merged": "Объединено: {loser} → {winner}",
  "merge.rejectedToast": "Отклонено объединение: {file}",
  "merge.conflicts": "Конфликты",
  "merge.preview": "Предпросмотр результата",

  // Shared
  "common.loading": "Загрузка…",
  "common.cancel": "Отмена",
  "common.save": "Сохранить",
  "common.saving": "Сохранение…",
  "common.clear": "сбросить",
  "common.close": "Закрыть",

  // Sidebar / navigation
  "nav.brandSuffix": "дашборд",
  "nav.dashboard": "Обзор",
  "nav.nodes": "Узлы",
  "nav.graph": "Граф",
  "nav.quarantine": "Карантин",
  "nav.newNode": "Новый узел",
  "nav.ariaMain": "Основная навигация",

  // Dashboard
  "dash.title": "Обзор",
  "dash.subtitle": "Сводка по графу — вживую из ~/.litopys/graph/",
  "dash.nodes": "Узлы",
  "dash.edges": "Связи",
  "dash.types": "Типы",
  "dash.byType": "По типам",
  "dash.error": "Ошибка загрузки статистики: {msg}",

  // Nodes table
  "nodes.title": "Узлы",
  "nodes.count": "{shown} из {total} {word}",
  "nodes.searchPlaceholder": "Поиск по id, описанию, тегам…",
  "nodes.searchAria": "Поиск узлов",
  "nodes.filterByType": "Фильтр по типу",
  "nodes.colType": "Тип",
  "nodes.colId": "Id",
  "nodes.colSummary": "Описание",
  "nodes.colUpdated": "Обновлён",
  "nodes.empty": "Под фильтры ничего не подходит.",
  "nodes.error": "Ошибка загрузки узлов: {msg}",

  // Node detail
  "node.back": "К списку узлов",
  "node.loading": "Загрузка узла…",
  "node.notFound": "Узел не найден",
  "node.tombstonedUntil": "помечен устаревшим до {date}",
  "node.edit": "Изменить",
  "node.delete": "Удалить",
  "node.deleteConfirm":
    "Пометить узел «{id}» устаревшим? (мягкое удаление, ставит 'until' на сегодня)",
  "node.metaUpdated": "Обновлён",
  "node.metaConfidence": "Уверенность",
  "node.metaTags": "Теги",
  "node.metaAliases": "Псевдонимы",
  "node.body": "Тело",
  "node.outgoing": "Исходящие",
  "node.incoming": "Входящие",
  "node.removeRelConfirm": "Удалить связь «{rel}» → «{target}»?",
  "node.removeRelAria": "Удалить {rel} → {target}",
  "node.fieldSummary": "Описание",
  "node.fieldBody": "Тело",
  "node.fieldTags": "Теги (через запятую)",
  "node.fieldAliases": "Псевдонимы (через запятую)",
  "node.fieldConfidence": "Уверенность: {value}",
  "node.addTargetPlaceholder": "id целевого узла",
  "node.add": "Добавить",

  // Graph
  "graph.title": "Граф",
  "graph.hint": "клик по узлу — фокус",
  "graph.fit": "Вписать",
  "graph.error": "Ошибка: {msg}",
  "graph.searchPlaceholder": "Найти узел…",
  "graph.focusOpen": "Открыть",
  "graph.focusExpand": "Развернуть +1 шаг",
  "graph.focusCollapse": "Свернуть до соседей",
  "graph.focusReset": "Сбросить фокус",

  // New node modal
  "modal.title": "Новый узел",
  "modal.type": "Тип",
  "modal.summary": "Описание",
  "modal.summaryPlaceholder": "Однострочное описание",
  "modal.id": "ID (kebab-case)",
  "modal.idAuto": "— авто",
  "modal.idPlaceholder": "my-node-id",
  "modal.tags": "Теги (через запятую)",
  "modal.body": "Тело (markdown, необязательно)",
  "modal.idRequired": "нужен id",
  "modal.create": "Создать",
  "modal.creating": "Создание…",
};

/** Russian plural form for the word "node". */
export function nodesWord(n: number): string {
  return plural(n, ["узел", "узла", "узлов"]);
}

/** Russian plural form for the word "relation/edge". */
export function relationsWord(n: number): string {
  return plural(n, ["связь", "связи", "связей"]);
}

export function t(key: string, params?: Params): string {
  let s = ru[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.replaceAll(`{${k}}`, String(v));
    }
  }
  return s;
}

/** Russian plural selector: forms = [one, few, many] (1 / 2 / 5). */
export function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

/** Human label + one-line explanation for every relation type. */
export const relationLabel: Record<RelationName, { label: string; hint: string }> = {
  owns: { label: "владеет", hint: "Кто чем владеет: человек → проект или система" },
  prefers: { label: "предпочитает", hint: "Человек → подход или концепт" },
  learned_from: {
    label: "вынесено из",
    hint: "Человек усвоил урок из события или другого урока",
  },
  uses: { label: "использует", hint: "Что чем пользуется" },
  applies_to: { label: "применимо к", hint: "Урок или концепт → проект или система" },
  conflicts_with: {
    label: "конфликтует с",
    hint: "Два факта противоречат друг другу (взаимно)",
  },
  runs_on: { label: "работает на", hint: "Проект или система работает поверх системы" },
  depends_on: { label: "зависит от", hint: "Без чего не работает" },
  reinforces: { label: "подкрепляет", hint: "Событие или урок усиливает концепт" },
  mentioned_in: { label: "упомянуто в", hint: "Узел фигурирует в событии" },
  supersedes: { label: "заменяет", hint: "Новый узел замещает устаревший" },
};

/** Russian label for each node type. */
export const nodeTypeLabel: Record<NodeType, string> = {
  person: "человек",
  project: "проект",
  system: "система",
  concept: "концепт",
  event: "событие",
  lesson: "урок",
};

/** Badge label for where a relation endpoint comes from. */
export const originLabel: Record<RefOrigin, string> = {
  new: "новый",
  existing: "в графе",
  unknown: "висячая ссылка",
};
