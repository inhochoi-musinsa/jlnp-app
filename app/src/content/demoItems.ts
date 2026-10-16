import type { QuizItem } from "../domain/quiz";

/** Development-only layout fixtures, reachable only at #demo on localhost. Not study content. */
export const DEMO_ITEMS: QuizItem[] = [
  {
    id: "demo-1",
    stem: "昨日《きのう》は雨《あめ》が降《ふ》っていたので、友達《ともだち》との約束《やくそく》を（　　）ことにした。",
    correctChoiceId: "a",
    explanationKo: "「〜ことにする」는 자신이 결정할 때 쓰며 앞에는 사전형이 온다. 이유를 나타내는 「ので」와 호응한다.",
    choices: [
      { id: "a", text: "やめる" },
      { id: "b", text: "やめた", whyWrong: "「ことにした」の前に過去形は来ない。", howToCorrect: "「やめる＋ことにした」と辞書形につなぐ。" },
      { id: "c", text: "やめて", whyWrong: "て形には「ことにした」が続かない。", howToCorrect: "辞書形「やめる」に直す。" },
      { id: "d", text: "やめない", whyWrong: "否定にすると約束を守る意味になり、雨の理由と合わない。", howToCorrect: "肯定の辞書形を選ぶ。" },
    ],
  },
  {
    id: "demo-2",
    stem: "町の図書館は、平日は午前九時から午後八時まで開いています。土曜日は午後五時に閉まります。日曜日と祝日は休みです。ただし、月に一度、第一日曜日だけは午前十時から午後三時まで開館し、子ども向けの本の読み聞かせ会が開かれます。会に参加する場合は、前の週の金曜日までに受付で申し込んでください。申し込みは電話でもできますが、その場合は名前と年齢を伝える必要があります。会の当日は、駐車場が使えませんので、自転車か徒歩でお越しください。\n\nこの図書館について、正しいものはどれか。",
    correctChoiceId: "c",
    explanationKo: "第一日曜日だけ開館し、読み聞かせ会がある。参加は前の週の金曜日までに申し込む。",
    choices: [
      { id: "a", text: "毎週日曜日に開いている", whyWrong: "日曜日は休みで、第一日曜日だけ開館する。", howToCorrect: "「第一日曜日だけ」に注目する。" },
      { id: "b", text: "当日でも申し込める", whyWrong: "前の週の金曜日までに申し込む必要がある。", howToCorrect: "申し込み期限の文を探す。" },
      { id: "c", text: "第一日曜日に読み聞かせ会がある" },
      { id: "d", text: "車で行ける", whyWrong: "会の当日は駐車場が使えない。", howToCorrect: "最後の文を確認する。" },
    ],
  },
  {
    id: "demo-3",
    stem: "「油断《ゆだん》」の意味に最も近いものはどれですか。",
    correctChoiceId: "d",
    explanationKo: "「油断」는 방심하다는 뜻이다. 한국어 「유단」과 형태가 비슷하지 않아도 의미를 혼동하기 쉽다.",
    choices: [
      { id: "a", text: "気を抜かずに注意すること", whyWrong: "反対の意味。", howToCorrect: "「油断大敵」の意味を確認する。" },
      { id: "b", text: "油をさすこと", whyWrong: "文字通りの意味ではない。", howToCorrect: "慣用的な意味で覚える。" },
      { id: "c", text: "ぼんやりして話を聞かないこと", whyWrong: "「放心」に近い意味で、「油断」とは異なる。", howToCorrect: "危険への注意が緩む意味かを確かめる。" },
      { id: "d", text: "注意をおこたること" },
    ],
  },
];
