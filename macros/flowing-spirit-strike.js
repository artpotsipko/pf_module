/**
 * Flowing Spirit Strike — Exemplar / Gleaming Blade
 * Foundry VTT v14, система PF2e 8.7.x. Тип макроса: Script.
 *
 * Что делает:
 *  1. Окно: оружие-ikon (если их несколько), тип урона (Energized Spark), MAP.
 *  2. Включает на листе тоггл Flowing Spirit Strike (First Strike) и бросает 1-й удар.
 *  3. Переключает тоггл на Second Strike (система сама даёт −2, если у клинка нет agile) и бросает 2-й удар.
 *     Оба удара с выбранным MAP — как в тексте действия.
 *  4. Flat check (цель concealed / hidden и т.п.): берётся из модуля PF2e Utility Buttons
 *     (pf2e-flatcheck-helper), который сам считает КС с учётом PF2e Visioner и пишет его в сообщение атаки.
 *     Если модуль не бросил проверку автоматически, макрос бросает её сам и записывает в то же сообщение.
 *     Проваленный flat check = промах этим ударом. Секретные проверки (цель undetected) знает только GM —
 *     в этом случае урон не бросается.
 *  5. Урон:
 *     - оба попали → весь урон spirit (или тип Energized Spark), один бросок одним сообщением:
 *       экземпляры урона одного типа сложены,
 *       поэтому сопротивления/слабости применяются один раз; precision учитывается только один раз;
 *     - попал один → обычный урон этого удара с родным типом оружия (spirit / Energized Spark
 *       не применяются; бонус immanence Gleaming Blade остаётся, как при любом ударе ikon'ом);
 *     - оба промахнулись → урона нет.
 *  6. Возвращает тогглы как было и предлагает, в какой из остальных ikon'ов переходит искра
 *     (Spark Transcendence: искра выбивается из Gleaming Blade в другой ikon на выбор).
 *     Если окно выбора закрыть крестиком — искра не трогается.
 *
 * Spirit-урон, −2 на второй удар и смену типа урона от Energized Spark считает сама система
 * через правила действия и фита. Макрос только переключает тогглы и бросает удары.
 *
 * Перед запуском: выдели токен персонажа и возьми в цель ровно одного врага.
 */

const FSS_OPTION = "flowing-spirit-strike";
const SPARK_OPTION = "divine-spark";
const ENERGY_OPTION = "energized-spark-damage";
const IKON_SLUG = "gleaming-blade";
const IKON_TAG = `item:tag:physical-ikon:${IKON_SLUG}`;
const FLAT_MODULE = "pf2e-flatcheck-helper";
const HIT_OUTCOMES = ["success", "criticalSuccess"];
const FLAT_TYPE_LABELS = { concealed: "скрыт", hidden: "спрятан", undetected: "не обнаружен", unnoticed: "не замечен" };

const fssWarn = (msg) => ui.notifications.warn(`Flowing Spirit Strike: ${msg}`);
const fssEsc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const outcomeLabel = (o) => game.i18n.localize(`PF2E.Check.Result.Degree.Attack.${o}`);

/* ---------- Тогглы на листе персонажа ---------- */

const getToggle = (pc, option) => pc.synthetics.toggles.all?.[option] ?? null;
const selectedSub = (toggle) => toggle?.suboptions.find((s) => s.selected)?.value ?? null;

async function setToggle(pc, option, value, suboption = null) {
    const toggle = getToggle(pc, option);
    if (!toggle) return;
    await pc.toggleRollOption("all", option, toggle.itemId, value, suboption ?? selectedSub(toggle));
}

/* ---------- Flat check (PF2e Utility Buttons) ---------- */

/**
 * Читает flat check'и, которые PF2e Utility Buttons записал в сообщение атаки. Недостающие броски
 * делает сам и сохраняет в сообщение (как кнопка модуля), чтобы результат был виден на карточке.
 * status: "none" — проверок нет, "pass", "fail", "unknown" — результат знает только GM / КС неизвестен.
 */
async function resolveFlatChecks(messageId) {
    const result = { status: "none", checks: [] };
    const message = messageId ? game.messages.get(messageId) : null;
    const checks = message?.flags?.[FLAT_MODULE]?.flatchecks;
    if (!checks) return result;

    const updates = {};
    for (const [key, check] of Object.entries(checks)) {
        if (!check || !("finalDc" in check)) continue; // служебные записи (счётчик целей)
        const dc = check.finalDc;
        if (dc != null && dc <= 1) continue; // автоуспех
        if (dc == null || check.secret) {
            result.checks.push({ type: check.type, dc, roll: null, passed: null });
            continue;
        }

        let roll = check.roll ?? null;
        if (roll == null && dc < 20) {
            const d20 = await new Roll("1d20").evaluate();
            game.dice3d?.showForRoll(d20, game.user, true, null, false, message.id);
            roll = d20.total;
            updates[`flags.${FLAT_MODULE}.flatchecks.${key}.roll`] = roll;
        } else if (roll != null && check.reroll?.keep === "low") {
            roll = Math.min(check.reroll.oldRoll, roll);
        } else if (roll != null && check.reroll?.keep === "high") {
            roll = Math.max(check.reroll.oldRoll, roll);
        }
        result.checks.push({ type: check.type, dc, roll, passed: dc < 20 && roll >= dc });
    }
    if (Object.keys(updates).length > 0) await message.update(updates);

    if (result.checks.some((c) => c.passed === false)) result.status = "fail";
    else if (result.checks.some((c) => c.passed === null)) result.status = "unknown";
    else if (result.checks.length > 0) result.status = "pass";
    return result;
}

const flatText = (flat) =>
    (flat?.checks ?? [])
        .filter((c) => c.roll != null)
        .map((c) => `flat check ${c.roll} / КС ${c.dc}${c.passed ? "" : " — провал"}`)
        .join(", ");

/* ---------- Удары ---------- */

const isIkonStrike = (a) => a.type === "strike" && (a.item?.getRollOptions?.("item") ?? []).includes(IKON_TAG);
// После каждого переключения тоггла система пересобирает удары, поэтому ищем удар заново по id оружия
const findStrike = (pc, itemId) => pc.system.actions.find((a) => a.type === "strike" && a.item?.id === itemId) ?? null;

async function rollAttack(pc, itemId, map, n) {
    const strike = findStrike(pc, itemId);
    if (!strike) throw new Error(`Strike for item ${itemId} not found`);
    let result = null;
    const roll = await strike.variants[map].roll({
        callback: (_roll, outcome, message) => {
            result = {
                outcome: outcome ?? null,
                context: message?.flags?.pf2e?.context ?? null,
                messageId: message?.id ?? null,
            };
        },
    });
    if (!roll) return null; // окно броска закрыли
    result ??= { outcome: null, context: null, messageId: null };

    result.flat = await resolveFlatChecks(result.messageId);
    if (result.flat.status === "fail" && HIT_OUTCOMES.includes(result.outcome)) {
        const failed = result.flat.checks.find((c) => c.passed === false);
        const why = FLAT_TYPE_LABELS[failed?.type] ?? failed?.type ?? "";
        ui.notifications.info(`Удар ${n}: провал flat check (${failed?.roll ?? "—"} < КС ${failed?.dc}${why ? `, цель ${why}` : ""}) — промах.`);
    }
    return result;
}

/**
 * Бросок урона удара. С capture=true сообщение в чат не создаётся: его данные перехватываются,
 * чтобы потом собрать одно общее сообщение с теми же флагами системы (кнопки применения урона и т.д.).
 */
async function rollDamage(pc, itemId, attack, map, { capture = false } = {}) {
    const strike = findStrike(pc, itemId);
    if (!strike) throw new Error(`Strike for item ${itemId} not found`);
    const method = attack.outcome === "criticalSuccess" ? "critical" : "damage";
    const params = { checkContext: attack.context, mapIncreases: map };
    if (!capture) return strike[method](params);

    let captured = null;
    const hookId = Hooks.on("preCreateChatMessage", (message, _data, options) => {
        if (captured || message.flags?.pf2e?.context?.type !== "damage-roll") return;
        captured = { data: message.toObject(), messageMode: options?.messageMode ?? options?.rollMode };
        return false; // отменяем создание отдельного сообщения
    });
    try {
        const roll = await strike[method](params);
        return roll && captured ? { roll, outcome: attack.outcome, flat: attack.flat, ...captured } : null;
    } finally {
        Hooks.off("preCreateChatMessage", hookId);
    }
}

/* ---------- Объединение урона ---------- */

/** Вырезает из дерева термов (в виде JSON) все части с флейвором precision */
function stripPrecision(data) {
    if (!data || typeof data !== "object") return data;
    const flavor = String(data.options?.flavor ?? "");
    if (flavor.split(",").map((f) => f.trim()).includes("precision")) return null;

    if (data.class === "Grouping") {
        const inner = stripPrecision(data.term);
        return inner ? { ...data, term: inner } : null;
    }
    if (data.class === "ArithmeticExpression") {
        const [left, right] = data.operands.map(stripPrecision);
        if (left && right) return { ...data, operands: [left, right] };
        if (data.operator === "+") return left ?? right ?? null;
        if (data.operator === "-") return left ?? null;
        return null; // умножение/деление на precision-часть целиком является precision
    }
    return data;
}

function combineDamage(A, B) {
    const RollTerm = foundry.dice.terms.RollTerm;
    const InstancePool = CONFIG.Dice.termTypes.InstancePool;
    const DamageRoll = CONFIG.Dice.rolls.find((c) => c.name === "DamageRoll");
    const DamageInstance = CONFIG.Dice.rolls.find((c) => c.name === "DamageInstance");
    if (!InstancePool || !DamageRoll || !DamageInstance) throw new Error("PF2e damage roll classes not found");

    // Precision добавляется один раз: оставляем больший, у второго удара вырезаем
    const precisionOf = (roll) => roll.instances.reduce((sum, i) => sum + i.componentTotal("precision"), 0);
    const pA = precisionOf(A.roll);
    const pB = precisionOf(B.roll);
    const stripFrom = pA > 0 && pB > 0 ? (pA >= pB ? B : A) : null;

    // Складываем экземпляры урона с одинаковым флейвором (тип + persistent + материалы),
    // уже выброшенные кубики сохраняются, ничего не перебрасывается
    const groups = new Map();
    for (const part of [A, B]) {
        for (const instance of part.roll.instances) {
            let data = JSON.parse(JSON.stringify(instance.head));
            if (part === stripFrom) data = stripPrecision(data);
            if (!data) continue;
            const flavor = String(instance.options.flavor ?? "");
            const key = flavor.split(",").map((f) => f.trim()).sort().join(",");
            const group = groups.get(key) ?? { options: foundry.utils.deepClone(instance.options), critRule: null, parts: [] };
            group.critRule ??= instance.critRule ?? null;
            group.parts.push(data);
            groups.set(key, group);
        }
    }

    const instances = [...groups.values()].map((group) => {
        const headData = group.parts.reduce((left, right) => ({
            class: "ArithmeticExpression",
            operator: "+",
            operands: [left, right],
            evaluated: true,
            options: {},
        }));
        const instance = DamageInstance.fromTerms([RollTerm.fromData(headData)], group.options);
        instance.critRule = group.critRule;
        return instance;
    });

    const base = B.outcome === "criticalSuccess" && A.outcome !== "criticalSuccess" ? B : A;
    const options = {
        ...base.roll.options,
        degreeOfSuccess: Math.max(A.roll.options.degreeOfSuccess ?? 2, B.roll.options.degreeOfSuccess ?? 2),
    };
    const roll = DamageRoll.fromTerms([InstancePool.fromRolls(instances)], options);
    return { roll, base, precisionStripped: !!stripFrom };
}

function buildFlavor(A, B, base, precisionStripped) {
    const parse = (html) => {
        const div = document.createElement("div");
        div.innerHTML = html ?? "";
        return div;
    };
    const wrap = parse(base.data.flavor);

    const header = document.createElement("h4");
    header.classList.add("action");
    header.innerHTML = `<strong>Flowing Spirit Strike</strong> <span class="subtitle">(урон объединён)</span>`;
    const oldHeader = wrap.querySelector("h4");
    oldHeader ? oldHeader.replaceWith(header) : wrap.prepend(header);

    const breakdowns = document.createElement("div");
    for (const [n, part] of [[1, A], [2, B]]) {
        const line = document.createElement("div");
        const flat = flatText(part.flat);
        line.innerHTML = `<strong>Удар ${n}:</strong> ${fssEsc(outcomeLabel(part.outcome))}${flat ? ` (${fssEsc(flat)})` : ""}`;
        breakdowns.append(line);
        const tags = parse(part.data.flavor).querySelector(".tags.modifiers");
        if (tags) breakdowns.append(tags);
    }
    if (precisionStripped) {
        const note = document.createElement("div");
        note.innerHTML = "<em>Precision-урон учтён один раз.</em>";
        breakdowns.append(note);
    }
    const oldBreakdown = wrap.querySelector(".tags.modifiers");
    oldBreakdown ? oldBreakdown.replaceWith(breakdowns) : wrap.append(breakdowns);

    return wrap.innerHTML;
}

async function postCaptured(part) {
    const data = foundry.utils.deepClone(part.data);
    delete data._id;
    return ChatMessage.implementation.create(data, { messageMode: part.messageMode });
}

async function postCombined(A, B) {
    let combined;
    try {
        combined = combineDamage(A, B);
    } catch (err) {
        console.error("Flowing Spirit Strike | не удалось объединить урон", err);
        fssWarn("не получилось объединить урон, выложены два отдельных броска — сложи вручную.");
        await postCaptured(A);
        await postCaptured(B);
        return;
    }

    const { roll, base, precisionStripped } = combined;
    const data = foundry.utils.deepClone(base.data);
    delete data._id;
    const extraRolls = [A, B].flatMap((p) => (p.data.rolls ?? []).slice(1)); // splash, если есть
    data.rolls = [JSON.stringify(roll.toJSON()), ...extraRolls];
    data.flavor = buildFlavor(A, B, base, precisionStripped);
    await ChatMessage.implementation.create(data, { messageMode: base.messageMode });
}

async function resolveDamage(pc, choice, first, second) {
    const attacks = [first, second];
    if (attacks.some((a) => a.outcome === null)) {
        fssWarn("не удалось определить попадание (нет КД цели?). Брось урон с карточек атак вручную.");
        return;
    }

    const rolledHits = attacks.filter((a) => HIT_OUTCOMES.includes(a.outcome));
    if (rolledHits.some((a) => a.flat?.status === "unknown")) {
        fssWarn("результат flat check знает только GM (цель undetected). Урон не брошен — брось его с карточки атаки после решения GM.");
        return;
    }

    const hits = rolledHits.filter((a) => a.flat?.status !== "fail");
    if (hits.length === 0) {
        ui.notifications.info("Flowing Spirit Strike: оба удара не попали.");
        return;
    }
    if (hits.length === 1) {
        // Объединения нет, значит урон обычный, в spirit не превращается: выключаем тоггл действия,
        // и система бросает урон с родным типом оружия
        await setToggle(pc, FSS_OPTION, false, "first-strike");
        await rollDamage(pc, choice.itemId, hits[0], choice.map);
        return;
    }

    const A = await rollDamage(pc, choice.itemId, first, choice.map, { capture: true });
    const B = await rollDamage(pc, choice.itemId, second, choice.map, { capture: true });
    if (A && B) {
        await postCombined(A, B);
    } else {
        // Один из бросков урона отменили в окне — выкладываем то, что есть
        for (const part of [A, B]) if (part) await postCaptured(part);
    }
}

/* ---------- Переход искры после Spark Transcendence ---------- */

async function moveSpark(pc) {
    const spark = getToggle(pc, SPARK_OPTION);
    if (!spark) return;
    const others = spark.suboptions.filter((s) => s.value !== IKON_SLUG);
    if (others.length === 0) {
        await setToggle(pc, SPARK_OPTION, false);
        return;
    }

    const target = await foundry.applications.api.DialogV2.wait({
        window: { title: "Spark Transcendence" },
        content: "<p>Искра выбита из Gleaming Blade. В какой ikon она переходит?</p>",
        buttons: others.map((s, i) => ({
            action: s.value,
            label: game.i18n.localize(s.label),
            default: i === 0,
        })),
        rejectClose: false,
    });
    if (!target) return; // окно закрыли — искру не трогаем
    await setToggle(pc, SPARK_OPTION, true, target);
}

/* ---------- Окно настроек ---------- */

async function askOptions(strikes, energy) {
    const ref = strikes.find((s) => s.ready) ?? strikes[0];

    const strikeField =
        strikes.length > 1
            ? `<div class="form-group"><label>Оружие</label><select name="itemId">${strikes
                  .map((s) => `<option value="${s.item.id}" ${s === ref ? "selected" : ""}>${fssEsc(s.label)}</option>`)
                  .join("")}</select></div>`
            : "";

    const spiritLabel = game.i18n.localize(CONFIG.PF2E.damageTypes.spirit ?? "Spirit");
    const energyField = energy
        ? `<div class="form-group"><label>Тип урона</label><select name="energy">
               <option value="spirit">${fssEsc(spiritLabel)}</option>
               ${energy.suboptions
                   .map(
                       (s) =>
                           `<option value="${s.value}" ${energy.checked && s.selected ? "selected" : ""}>${fssEsc(
                               game.i18n.localize(s.label),
                           )}</option>`,
                   )
                   .join("")}
           </select></div>`
        : "";

    const content = `
        ${strikeField}
        ${energyField}
        <p>Какая это атака в ходу? Оба удара бросаются с этим штрафом MAP.</p>`;

    const names = ["1-я атака", "2-я атака", "3-я атака"];
    const buttons = [0, 1, 2].map((map) => ({
        action: `map${map}`,
        label: `${names[map]} (${ref.variants[map].label})`,
        default: map === 0,
        callback: (_event, button) => {
            const f = button.form.elements;
            return {
                map,
                itemId: f.itemId?.value ?? ref.item.id,
                energy: f.energy?.value ?? null,
            };
        },
    }));

    return foundry.applications.api.DialogV2.wait({
        window: { title: "Flowing Spirit Strike" },
        content,
        buttons,
        rejectClose: false,
    });
}

/* ---------- Основной сценарий ---------- */

async function flowingSpiritStrike() {
    const pc = canvas.tokens.controlled[0]?.actor ?? game.user.character;
    if (!pc?.isOfType?.("character")) return fssWarn("выдели токен своего персонажа.");

    const fss = getToggle(pc, FSS_OPTION);
    if (!fss) return fssWarn("у персонажа нет действия Flowing Spirit Strike (нужен ikon Gleaming Blade).");
    if (!fss.enabled) return fssWarn("искра не в Gleaming Blade, сначала Shift Immanence.");

    const strikes = pc.system.actions.filter(isIkonStrike);
    if (strikes.length === 0) return fssWarn("не найден удар оружием-ikon Gleaming Blade.");
    if (game.user.targets.size !== 1) return fssWarn("возьми в цель ровно одного противника.");
    if (!game.modules.get(FLAT_MODULE)?.active) {
        fssWarn("модуль PF2e Utility Buttons выключен — flat check против скрытых целей не учитывается.");
    }

    const energy = getToggle(pc, ENERGY_OPTION);
    const choice = await askOptions(strikes, energy);
    if (!choice) return;

    const energyBefore = energy ? { on: energy.checked, sub: selectedSub(energy) } : null;
    let energyChanged = false;
    let performed = false;

    try {
        // Energized Spark: выбранный в окне тип урона
        if (energy && choice.energy) {
            if (choice.energy === "spirit" && energy.checked) {
                await setToggle(pc, ENERGY_OPTION, false);
                energyChanged = true;
            } else if (choice.energy !== "spirit" && (!energy.checked || energyBefore.sub !== choice.energy)) {
                await setToggle(pc, ENERGY_OPTION, true, choice.energy);
                energyChanged = true;
            }
        }

        await setToggle(pc, FSS_OPTION, true, "first-strike");
        const first = await rollAttack(pc, choice.itemId, choice.map, 1);
        if (!first) return;
        performed = true;

        await setToggle(pc, FSS_OPTION, true, "second-strike");
        const second = await rollAttack(pc, choice.itemId, choice.map, 2);
        if (!second) return fssWarn("второй удар отменён, урон не брошен.");

        await resolveDamage(pc, choice, first, second);
    } catch (err) {
        console.error("Flowing Spirit Strike |", err);
        ui.notifications.error("Flowing Spirit Strike: ошибка, подробности в консоли (F12).");
    } finally {
        try {
            await setToggle(pc, FSS_OPTION, false, "first-strike");
            if (energyChanged) await setToggle(pc, ENERGY_OPTION, energyBefore.on, energyBefore.sub);
            if (performed) await moveSpark(pc);
        } catch (err) {
            console.error("Flowing Spirit Strike | ошибка при возврате тогглов", err);
            ui.notifications.error("Flowing Spirit Strike: не удалось вернуть тогглы/искру, проверь лист персонажа.");
        }
    }
}

await flowingSpiritStrike();
