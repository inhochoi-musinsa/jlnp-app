# 청해 문항 형식과 선택지 수 (T00 ⑤)

## 상태: **미확인**
- 대상: 2018 공식 문제집 N3 청해 `https://www.jlpt.jp/samples/sample2018/pdf/N3L.pdf`.
- 확인 시도: 문서를 내려받았으나(1.7 MB) 텍스트 레이어가 없는 이미지 PDF이며, 이 환경에는 PDF 렌더러(poppler 등)가 없어 **문항별 선택지 수·인쇄 여부를 읽지 못했다**. 브라우저 창에서는 다운로드로 처리되어 열리지 않았다.
- 따라서 유형별 `officialChoiceCount`와 "선택지가 인쇄되는가"는 **추정하지 않고 미확인으로 둔다.**

## 지금 적용하는 설계(확정 전 가정, `[실무 제안]`)
- 앱 청해 문항은 UX 불변조건에 따라 **항상 4선지·텍스트 선택지**로 만든다.
- 각 `LISTENING` 레코드에 `officialChoiceCount?`(미확인이면 생략)를 둘 수 있게 스키마에 선택 필드를 열어 둔다(T02). 공식이 3지선다인 유형이 있으면 앱 4선지와의 차이를 이 문서에 기록한다.
- 이 차이로 "실전과 동일한 형식"이라고 표시하지 않는다(한계 문구 의무 유지).

## 후속
사용자가 PDF를 직접 열어 유형별 선택지 수(과제·포인트·개요·발화표현·즉시응답)를 확인해 알려 주거나, `brew install poppler` 후 재시도하면 이 문서를 갱신한다(T14 전).

## T14 구현 결정
- 재생 소스 우선순위: `audio/overrides/<contentId>.mp3`(RECORDED) > `audio/<audioKey>.mp3`(GENERATED_FILE) > 브라우저 음성(BROWSER_TTS, 연습 전용·설정으로 끌 수 있음). 파일 존재는 재생 버튼을 누를 때 HEAD로 확인하며 그 전에는 아무것도 내려받지 않는다(`preload="none"`).
- LISTENING 레코드는 `questionId`로 문제를 가리키고(문제 → 청해 역참조는 id 순환이라 불가), 앱은 이 문제를 낱개 연습에서 제외하고 청해를 통해서만 낸다. 듣고 쓰기 항목(`dictation: true`)은 문제 없이 입력 방식만 4지선다 불변조건의 예외다(여전히 "다음 계속하기"로만 진행).
- 진단·평가 청해는 1회 재생, 연습은 설정(무제한/1회). 풀이 기록(`QUESTION_SUBMITTED`)에 `audioSource`, `plays`를 남긴다.
- 로컬 확인용 `macos-say` 엔진 음원은 공개하지 않는다. 실제 Google TTS 합성은 BLOCKED(TTS). 기기 재생(Android)은 BLOCKED(DEVICE).
