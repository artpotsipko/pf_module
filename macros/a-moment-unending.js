/**
 * A Moment Unending — Exemplar / Gaze Sharp as Steel
 * Foundry VTT v14, система PF2e 8.7.x. Тип макроса: Script.
 *
 * Что делает:
 *  1. Проверяет, что искра в Gaze Sharp as Steel (иначе Transcendence недоступен).
 *  2. Выкладывает карточку действия в чат.
 *  3. Вешает на персонажа эффект «A Moment Unending»: следующий успешный Strike даёт +1d6 precision
 *     (2d6 с 10-го уровня, 3d6 с 18-го). Длительность — до конца твоего следующего хода, по её истечении
 *     система сама отключает эффект.
 *  4. Эффект снимается автоматически после первого броска урона Strike (попадание или крит),
 *     в т.ч. объединённого урона из макроса Flowing Spirit Strike — там precision учитывается один раз.
 *     Слежение работает до перезагрузки страницы; если перезагрузился, сними эффект руками после удара.
 *  5. Spark Transcendence: предлагает, в какой из остальных ikon'ов переходит искра.
 *     Если окно закрыть крестиком — искра не трогается.
 *
 * Перед запуском: выдели токен персонажа (или назначь персонажа пользователю).
 */

const IKON_SLUG = "gaze-sharp-as-steel";
const ACTION_SLUG = "a-moment-unending";
const EFFECT_SLUG = "effect-a-moment-unending-macro";
const HOOK_KEY = "pf2eMacrosAMomentUnendingHook";
const SPARK_OPTION = "divine-spark";

const amuWarn = (msg) => ui.notifications.warn(`A Moment Unending: ${msg}`);

/* ---------- Тогглы и искра ---------- */

const getToggle = (pc, option) => pc.synthetics.toggles.all?.[option] ?? null;
const selectedSub = (toggle) => toggle?.suboptions.find((s) => s.selected)?.value ?? null;

async function setToggle(pc, option, value, suboption = null) {
    const toggle = getToggle(pc, option);
    if (!toggle) return;
    await pc.toggleRollOption("all", option, toggle.itemId, value, suboption ?? selectedSub(toggle));
}

/** Spark Transcendence: искра выбивается из использованного ikon'а в другой на выбор */
async function moveSpark(pc, fromSlug) {
    const spark = getToggle(pc, SPARK_OPTION);
    if (!spark) return;
    const others = spark.suboptions.filter((s) => s.value !== fromSlug);
    if (others.length === 0) {
        await setToggle(pc, SPARK_OPTION, false);
        return;
    }

    const target = await foundry.applications.api.DialogV2.wait({
        window: { title: "Spark Transcendence" },
        content: "<p>Искра выбита из ikon'а. В какой ikon она переходит?</p>",
        buttons: others.map((s, i) => ({ action: s.value, label: game.i18n.localize(s.label), default: i === 0 })),
        rejectClose: false,
    });
    if (!target) return; // окно закрыли — искру не трогаем
    await setToggle(pc, SPARK_OPTION, true, target);
}

/* ---------- Эффект ---------- */

function effectData(item) {
    return {
        type: "effect",
        name: `Эффект: ${item.name}`,
        img: item.img,
        system: {
            slug: EFFECT_SLUG,
            description: { value: item.system.description?.value ?? "" },
            duration: { value: 1, unit: "rounds", expiry: "turn-end", sustained: false },
            rules: [
                {
                    key: "DamageDice",
                    selector: "strike-damage",
                    category: "precision",
                    dieSize: "d6",
                    diceNumber: "ternary(gte(@actor.level,18),3,ternary(gte(@actor.level,10),2,1))",
                },
            ],
        },
    };
}

/** Снимает эффект после первого броска урона Strike этого персонажа (до перезагрузки страницы) */
function watchConsumption(pc) {
    if (globalThis[HOOK_KEY]) Hooks.off("createChatMessage", globalThis[HOOK_KEY]);
    globalThis[HOOK_KEY] = Hooks.on("createChatMessage", async (message) => {
        if (!message.isAuthor || message.actor?.id !== pc.id) return;
        const context = message.flags?.pf2e?.context;
        if (context?.type !== "damage-roll" || !context.domains?.includes("strike-damage")) return;

        Hooks.off("createChatMessage", globalThis[HOOK_KEY]);
        delete globalThis[HOOK_KEY];

        const effect = pc.itemTypes.effect.find((e) => e.slug === EFFECT_SLUG);
        if (!effect) return;
        const wasActive = !effect.isExpired;
        await effect.delete();
        if (wasActive) ui.notifications.info("A Moment Unending: дополнительный precision-урон использован, эффект снят.");
    });
}

/* ---------- Основной сценарий ---------- */

async function aMomentUnending() {
    const pc = canvas.tokens.controlled[0]?.actor ?? game.user.character;
    if (!pc?.isOfType?.("character")) return amuWarn("выдели токен своего персонажа.");

    const item = pc.itemTypes.action.find((i) => i.slug === ACTION_SLUG);
    if (!item) return amuWarn("у персонажа нет действия A Moment Unending (нужен ikon Gaze Sharp as Steel).");
    if (!pc.rollOptions.all?.[`${SPARK_OPTION}:${IKON_SLUG}`]) {
        return amuWarn("искра не в Gaze Sharp as Steel, сначала Shift Immanence.");
    }

    try {
        await item.toMessage();

        const old = pc.itemTypes.effect.filter((e) => e.slug === EFFECT_SLUG).map((e) => e.id);
        if (old.length > 0) await pc.deleteEmbeddedDocuments("Item", old);
        await pc.createEmbeddedDocuments("Item", [effectData(item)]);
        watchConsumption(pc);

        await moveSpark(pc, IKON_SLUG);
    } catch (err) {
        console.error("A Moment Unending |", err);
        ui.notifications.error("A Moment Unending: ошибка, подробности в консоли (F12).");
    }
}

await aMomentUnending();
