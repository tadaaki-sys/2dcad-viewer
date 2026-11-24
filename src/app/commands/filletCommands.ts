// FILLET(角の丸め)と CHAMFER(角の面取り)のコマンド。React にも画面にも依存しない。
// 図面は直接変更せず、依頼を返す。適用と履歴への記録は、画面の側が DocumentSession を通して行う(1回の操作 = Undoの1段階)。
//
// FILLET : 半径(数値。Enter = 前回の値。初期値 0)→ 1つ目の線をクリック → 2つ目の線をクリック → 続けて1つ目をクリック …(Enter・Esc で終了)
// CHAMFER: 距離1(Enter = 前回の値)→ 距離2(Enter = 前回の値)→ 1つ目の線をクリック → 2つ目の線をクリック → 続けて …
//         距離1は1つ目に選んだ線の上、距離2は2つ目に選んだ線の上の、角からの距離。
// 対象は、線と折れ線だけ。別々の2本の線、または、1本の折れ線の隣り合う2本の線分(その線分の上をクリックする)。
// 図形を指すクリックは、吸着しない(rawPoints): 吸着すると、ほかの図形の端点などへ吸い寄せられて、指したい図形が決まらないため。
// 前回の値は、コマンドの定義が持つ(createFilletCommands で作り直すと、初期値 0 に戻る。画面では、1つの定義を使い続ける)。
import { endedMessage, NOT_READY_MESSAGE } from "./editCommands";
import type { Step } from "./editCommands";
import { NO_DOCUMENT_MESSAGE } from "./types";
import type { AppCommandContext, AppCommandDefinition, AppRequest, CornerPick } from "./types";

const FILLET_NAME = "フィレット";
const CHAMFER_NAME = "面取り";
const ENDED_DETAIL = "図形は、それまでの分だけ変更されています";

/** 数値の表示(有効数字6桁まで。余分な 0 は付けない) */
const formatNumber = (value: number): string => String(Number(value.toPrecision(6)));

type Remembered = { radius: number; distance1: number; distance2: number };

/**
 * 図形を2つ続けてクリックして、そのたびに依頼を返し、最初の図形へ戻る(Enter・Esc で終了)段階の組。
 * @param commandName コマンドの名前(終了のメッセージ用)
 * @param operationName 操作の名前(図形を探すときの、断りの文用)
 * @param request 2つのクリックから、依頼を作る
 */
function pickSteps(commandName: string, operationName: string, request: (first: CornerPick, second: CornerPick) => AppRequest, context: AppCommandContext): Step {
  const secondStep = (first: CornerPick): Step => {
    const step: Step = {
      type: "prompt",
      prompt: "2つ目の線(同じ折れ線の隣り合う線分)をクリックしてください[Enter=終了]",
      expect: "point",
      acceptsEnter: true,
      rawPoints: true,
      onInput: (input) => {
        if (input.kind === "enter") return { type: "done", messages: [endedMessage(commandName, ENDED_DETAIL)] };
        if (input.kind !== "point") return step;
        const picked = context.editing.pickEntity(input.point, operationName, "chain");
        if (!picked.ok) return { ...step, messages: [picked.message] };
        // 反映の依頼を出して、最初の図形を選ぶ段階へ戻る(続けて、次の角を処理できる)
        return { ...firstStep(), messages: [], requests: [request(first, { id: picked.id, point: input.point })] };
      },
    };
    return step;
  };

  const firstStep = (): Step => {
    const step: Step = {
      type: "prompt",
      prompt: "1つ目の線(または折れ線の線分)をクリックしてください[Enter=終了]",
      expect: "point",
      acceptsEnter: true,
      rawPoints: true,
      onInput: (input) => {
        if (input.kind === "enter") return { type: "done", messages: [endedMessage(commandName, ENDED_DETAIL)] };
        if (input.kind !== "point") return step;
        const picked = context.editing.pickEntity(input.point, operationName, "chain");
        if (!picked.ok) return { ...step, messages: [picked.message] };
        return secondStep({ id: picked.id, point: input.point });
      },
    };
    return step;
  };

  return firstStep();
}

/**
 * 数値(0 以上)を入力する段階。Enter = 前回の値。
 * @param prompt 問い合わせの文(前回の値を含める)
 * @param current 前回の値
 * @param label 断りの文に使う呼び名(「半径」「距離」)
 * @param accept 入力された値(または前回の値)を受け取って、次の段階を返す。断るときは、メッセージ(文字列)を返す
 */
function numberStep(prompt: string, current: number, label: string, accept: (value: number) => Step | string): Step {
  const step: Step = {
    type: "prompt",
    prompt,
    expect: "distance",
    acceptsEnter: true,
    onInput: (input) => {
      if (input.kind !== "enter" && input.kind !== "distance") return step;
      const value = input.kind === "enter" ? current : input.value;
      if (!(value >= 0) || !Number.isFinite(value)) return { ...step, messages: [`${label}は、0 以上の数にしてください`] };
      const next = accept(value);
      return typeof next === "string" ? { ...step, messages: [next] } : next;
    },
  };
  return step;
}

function guard(context: AppCommandContext): { type: "done"; messages: readonly string[] } | null {
  if (!context.isDocumentOpen) return { type: "done", messages: [NO_DOCUMENT_MESSAGE] };
  if (!context.editing.ready) return { type: "done", messages: [NOT_READY_MESSAGE] };
  return null;
}

/** FILLET・CHAMFER の定義を作る。前回の値(半径・距離)は、作った定義ごとに持つ */
export function createFilletCommands(): readonly AppCommandDefinition[] {
  const last: Remembered = { radius: 0, distance1: 0, distance2: 0 };
  return [
    {
      name: "FILLET",
      aliases: ["FIL"],
      description: "2本の線(または折れ線の隣り合う線分)の角を、円弧で丸める(繰り返せる)",
      start: (context) =>
        guard(context) ??
        numberStep(`半径を入力してください(前回の値: ${formatNumber(last.radius)})[Enter=前回の値]`, last.radius, "半径", (radius) => {
          last.radius = radius;
          return pickSteps("FILLET", FILLET_NAME, (first, second) => ({ type: "filletEntities", first, second, radius }), context);
        }),
    },
    {
      name: "CHAMFER",
      aliases: ["CHA"],
      description: "2本の線(または折れ線の隣り合う線分)の角を、斜めの線で面取りする(繰り返せる)",
      start: (context) => {
        const blocked = guard(context);
        if (blocked !== null) return blocked;
        const distance1Step = (): Step =>
          numberStep(`1つ目の距離を入力してください(前回の値: ${formatNumber(last.distance1)})[Enter=前回の値]`, last.distance1, "距離", (distance1) =>
            numberStep(`2つ目の距離を入力してください(前回の値: ${formatNumber(last.distance2)})[Enter=前回の値]`, last.distance2, "距離", (distance2) => {
              // 片方だけ 0 は、線の上を動かすだけで角にならないので、断る。1つ目の距離から入力し直せる(1つ目の値も直せるように)
              if ((distance1 === 0) !== (distance2 === 0)) {
                return { ...distance1Step(), messages: ["距離は、2つとも 0、または2つとも 0 より大きい数にしてください(片方だけ 0 にはできません)。1つ目の距離から入力し直してください"] };
              }
              last.distance1 = distance1;
              last.distance2 = distance2;
              return pickSteps("CHAMFER", CHAMFER_NAME, (first, second) => ({ type: "chamferEntities", first, second, distance1, distance2 }), context);
            }),
          );
        return distance1Step();
      },
    },
  ];
}

export const FILLET_COMMANDS: readonly AppCommandDefinition[] = createFilletCommands();
