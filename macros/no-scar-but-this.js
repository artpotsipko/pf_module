/**
 * No Scar but This — Exemplar / Scar of the Survivor
 * Foundry VTT v14, система PF2e 8.7.x. Тип макроса: Script.
 *
 * Что делает:
 *  1. Проверяет, что искра в Scar of the Survivor (иначе Transcendence недоступен).
 *  2. Бросает лечение (уровень/2, округление вверх)d8 vitality в чат и сразу применяет его к персонажу.
 *     На карточке броска остаются кнопки применения — второй раз нажимать не нужно.
 *  3. Spark Transcendence: предлагает, в какой из остальных ikon'ов переходит искра.
 *     Если окно закрыть крестиком — искра не трогается.
 *
 * Перед запуском: выдели токен персонажа (или назначь персонажа пользователю).
 */

const IKON_SLUG = "scar-of-the-survivor";
const ACTION_SLUG = "no-scar-but-this";
const SPARK_OPTION = "divine-spark";

const nsWarn = (msg) => ui.notifications.warn(`No Scar but This: ${msg}`);
const nsEsc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

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

function actionHeader(item) {
    const traits = (item.system.traits?.value ?? [])
        .map((t) => `<span class="tag" data-trait="${t}">${nsEsc(game.i18n.localize(CONFIG.PF2E.actionTraits[t] ?? t))}</span>`)
        .join("");
    return `<h4 class="action"><strong>${nsEsc(item.name)}</strong> <span class="action-glyph">1</span></h4><div class="tags">${traits}</div><hr>`;
}

/* ---------- Основной сценарий ---------- */

async function noScarButThis() {
    const pc = canvas.tokens.controlled[0]?.actor ?? game.user.character;
    if (!pc?.isOfType?.("character")) return nsWarn("выдели токен своего персонажа.");

    const item = pc.itemTypes.action.find((i) => i.slug === ACTION_SLUG);
    if (!item) return nsWarn("у персонажа нет действия No Scar but This (нужен ikon Scar of the Survivor).");
    if (!pc.rollOptions.all?.[`${SPARK_OPTION}:${IKON_SLUG}`]) {
        return nsWarn("искра не в Scar of the Survivor, сначала Shift Immanence.");
    }

    try {
        const DamageRoll = CONFIG.Dice.rolls.find((c) => c.name === "DamageRoll");
        const dice = Math.ceil(pc.level / 2);
        const roll = await new DamageRoll(`(${dice}d8)[healing,vitality]`, {}, { rollerId: game.user.id }).evaluate();

        const tokenDoc =
            canvas.tokens.controlled.find((t) => t.actor === pc)?.document ?? pc.getActiveTokens(true, true)[0] ?? null;
        await roll.toMessage({
            speaker: ChatMessage.getSpeaker({ actor: pc, token: tokenDoc }),
            flavor: `${actionHeader(item)}<p><em>Лечение применено автоматически.</em></p>`,
            flags: { pf2e: { origin: item.getOriginData() } },
        });

        // Лечение = отрицательный урон (так же делает кнопка «применить лечение» в чате)
        if (tokenDoc) {
            await pc.applyDamage({
                damage: -roll.total,
                token: tokenDoc,
                item,
                skipIWR: true,
                rollOptions: new Set(item.getRollOptions("item")),
            });
        } else {
            const hp = pc.system.attributes.hp;
            await pc.update({ "system.attributes.hp.value": Math.min(hp.max, hp.value + roll.total) });
        }

        await moveSpark(pc, IKON_SLUG);
    } catch (err) {
        console.error("No Scar but This |", err);
        ui.notifications.error("No Scar but This: ошибка, подробности в консоли (F12).");
    }
}

await noScarButThis();
