# PF2e Foundry — личные макросы и модули

Проект для разработки макросов (и при необходимости модулей) для Foundry VTT под систему Pathfinder 2e.
Делается для себя: закрывать функционал героев, которого нет в системе и популярных модулях
(PF2e Macros, PF2e Workbench, PF2e Toolbelt уже проверены).

Общение с пользователем и текст в интерфейсе макросов — на русском.

## Окружение

- **Foundry VTT v14**, **система pf2e 8.7.0**. При смене версий уточнить у пользователя.
- Пользователь — **игрок**, сервер свой. Модули ставит GM (по manifest URL), поэтому по умолчанию
  предпочитаем **standalone Script-макрос**, который пользователь вставляет в Foundry сам.
  Модуль — только когда нужны хуки или общий код для многих макросов.
- **Локально Foundry нет.** Сервер: `https://foundry.zeldrak.ru/game` (пользователь залогинен в Chrome
  «Browser 2 (Windows)»). Через Claude in Chrome можно читать данные мира/персонажа и проверять API в
  `javascript_tool` — но **ничего не бросать в чат и не менять лист без согласия пользователя** (это живая игра).
  Полный прогон макроса делает пользователь.
- Персонаж: **Базгиру**, Exemplar. Ikon'ы: Gleaming Blade (фальшион), Scar of the Survivor, Gaze Sharp as Steel.
  Energized Spark (огонь).
- Важные модули мира: **PF2e Utility Buttons** (`pf2e-flatcheck-helper`, flat check'и в сообщениях атак,
  у пользователя включён автобросок), **PF2E Visioner** (видимость по наблюдателю), PF2e Toolbelt,
  xdy Workbench, PF2e HUD, Token Action HUD, Dice So Nice нет.
- Репозиторий: `git@github.com:artpotsipko/pf_module.git`, ветка `main` (SSH-ключ настроен, `gh` нет).

## Структура

- `macros/` — Script-макросы, по одному файлу на действие/фичу. В шапке файла — что делает,
  версии Foundry/pf2e, требования перед запуском (выделенный токен, цель и т.п.).

## Правила для макросов

- Foundry оборачивает код макроса в `async function(speaker, actor, token, character, scope, ...)`:
  top-level `await` и `return` работают, но **нельзя объявлять `const`/`let` с именами
  `actor`, `token`, `character`, `speaker`, `scope`, `event`, `args`** — будет SyntaxError.
- Сначала опираться на механику системы: многие действия уже имеют Rule Elements
  (тогглы `RollOption`, `DamageAlteration`, `FlatModifier`). Лучше переключить существующий тоггл
  и бросить через штатный API, чем пересчитывать модификаторы вручную.
- Всё, что макрос меняет на листе (тогглы), возвращать обратно в `finally`.
- Ошибки: `console.error` + `ui.notifications.error`, чтобы пользователь мог прислать текст из консоли (F12).

## Проверка

Запустить нельзя, поэтому минимум — проверка синтаксиса в той же обёртке, что у Foundry:

```bash
(echo "async function __m(speaker, actor, token, character, scope){"; cat macros/<file>.js; echo "}") > <scratchpad>/check.js && node --check <scratchpad>/check.js
```

## Как изучать API pf2e

Документации по внутреннему API почти нет — источник истины это исходники нужного тега.
Тег версии: `pf2e-<версия>` (например `pf2e-8.7.0`). Клонировать в scratchpad sparse-копией:

```bash
git clone --depth 1 --branch pf2e-8.7.0 --filter=blob:none --sparse https://github.com/foundryvtt/pf2e.git pf2e
cd pf2e && git sparse-checkout set src types
git sparse-checkout add packs/pf2e/<нужная папка>   # данные предметов/фитов/действий (JSON с rules)
```

Полезные места: `src/module/actor/character/document.ts` (strikes: `variants[].roll`, `damage`/`critical`),
`src/module/system/rolls.ts` (параметры бросков), `src/module/system/damage/` (`DamageRoll`, термы),
`src/module/system/check/check.ts`, `src/module/rules/rule-element/roll-option/`.

## Проверенные факты API (pf2e 8.7)

- Удары персонажа: `actor.system.actions.filter(a => a.type === "strike")`. После любого изменения
  предмета/тоггла актор пересобирается — удар нужно искать заново (по `a.item.id`).
- Атака: `strike.variants[mapIndex].roll({ callback: (roll, outcome, message) => ... })`;
  `outcome` — `"criticalSuccess" | "success" | "failure" | "criticalFailure"` (null без DC/цели),
  `message.flags.pf2e.context` можно передать в урон как `checkContext`.
- Урон: `strike.damage(params)` / `strike.critical(params)`, `params.createMessage: false` — без сообщения.
  `getFormula: true` работает в режиме viewOnly и **игнорирует цель** — для реального урона не годится.
- Тогглы: `actor.synthetics.toggles.all[option]` → `{ itemId, checked, enabled, suboptions[{value,label,selected}] }`;
  переключение: `actor.toggleRollOption("all", option, toggle.itemId, value, suboption)`.
  Для mergeable-тогглов передавать suboption, иначе обновится только одно правило семейства.
- Классы бросков: `CONFIG.Dice.rolls` (`DamageRoll`, `DamageInstance`), термы в `CONFIG.Dice.termTypes`
  (`ArithmeticExpression`, `Grouping`, `InstancePool`). Уже брошенные экземпляры урона можно
  сложить без переброса через JSON термов + `DamageInstance.fromTerms` / `DamageRoll.fromTerms`.
- Перехват системного сообщения: `Hooks.on("preCreateChatMessage", ...)` с `return false` отменяет
  создание, а `message.toObject()` даёт готовые данные с флагами pf2e — их можно доработать и создать одно своё сообщение.
- Окна: `foundry.applications.api.DialogV2.wait({ window, content, buttons, rejectClose: false })`,
  в `callback(event, button)` поля формы — `button.form.elements`; кнопка без callback возвращает свой `action`.
- Flat check: система pf2e сама их **не** бросает. Их считает PF2e Utility Buttons в `_preCreate` сообщения атаки
  (с учётом Visioner) и пишет в `message.flags["pf2e-flatcheck-helper"].flatchecks` →
  `{ target: { type: "hidden", baseDc, finalDc, roll?, reroll?: { oldRoll, keep }, secret? } }`.
  `finalDc <= 1` — автоуспех, `null`/`>= 20` — неизвестно/невозможно, `secret` (undetected) — результат знает только GM.
  Если `roll` нет, можно бросить d20 и записать `flags.pf2e-flatcheck-helper.flatchecks.<key>.roll` в сообщение (как кнопка модуля).
- Силовое (forceful) и twin: система добавляет модификаторы `forceful-second`/`forceful-third` с `ignored: true`
  и сама их **никогда** не включает (только галочка в окне урона). Включить из макроса: эффект с `FlatModifier`
  (`selector: "strike-damage"`, `type: "circumstance"`, `value` = `weapon.system.damage.dice` × уровень) и
  predicate на свою опцию, а опцию передать в `strike.damage({ options: [...] })` — `params.options` доходят до предикатов.
- Exemplar: искра — mergeable-тоггл `divine-spark`, suboption = slug ikon'а (список ikon'ов берётся из `suboptions`).
  По правилам Transcendence искра сразу после действия выбивается в **другой** ikon на выбор.

## Готовые макросы

- `macros/flowing-spirit-strike.js` — Exemplar, Gleaming Blade: два удара через тоггл действия,
  при двух попаданиях урон spirit / Energized Spark объединяется в одно сообщение (IWR и precision — один раз);
  при одном попадании — обычный урон с типом оружия. Учитывает flat check'и PF2e Utility Buttons
  (провал = промах), в конце предлагает перенести искру в другой ikon. Силовое (forceful) считает по номеру
  атаки в ходу (MAP из окна + номер удара) через временный скрытый эффект, удаляемый в `finally`.
- `macros/no-scar-but-this.js` — Scar of the Survivor: бросает (ceil(уровень/2))d8 vitality-лечения,
  сразу применяет к себе (`applyDamage` с отрицательным уроном), переносит искру.
- `macros/a-moment-unending.js` — Gaze Sharp as Steel: карточка действия + эффект с `DamageDice` precision
  (длительность 1 раунд до конца хода), эффект снимается хуком после первого урона Strike (живёт до перезагрузки),
  переносит искру.

Общий код (тогглы, `moveSpark`) продублирован в каждом макросе — так макрос остаётся самодостаточным для вставки.
Проверять механику без побочных эффектов удобно на `actor.clone({ items: [...] }, { keepId: true })` +
`strike.damage({ getFormula: true })` — копия не сохраняется, сообщений нет.
