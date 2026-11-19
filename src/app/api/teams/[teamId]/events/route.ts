import { NextRequest, NextResponse } from "next/server";
import { getChatHistory, getIdeas } from "@/lib/redis";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ teamId: string }> }
) {
  const resolvedParams = await params;
  const teamId = resolvedParams.teamId;

  // SSE 헤더 설정
  const headers = new Headers({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Cache-Control",
  });

  // SSE 스트림 생성
  const stream = new ReadableStream({
    start(controller) {
      console.log("🔥 SSE 연결 시작:", teamId);

      // 초기 데이터 전송
      const sendInitialData = async () => {
        try {
          const [messages, ideas] = await Promise.all([
            getChatHistory(teamId),
            getIdeas(teamId),
          ]);

          controller.enqueue(
            `data: ${JSON.stringify({
              type: "initial",
              messages,
              ideas,
              timestamp: new Date().toISOString(),
            })}\n\n`
          );
          console.log("📤 초기 데이터 전송 완료");
        } catch (error) {
          console.error("초기 데이터 전송 실패:", error);
        }
      };

      sendInitialData();

      // 실시간 업데이트 체크 (2초마다 - 더 빠른 응답)
      let lastMessageTimestamp = "";
      let lastIdeaTimestamp = "";
      let isClosed = false;

      const checkForUpdates = async () => {
        try {
          // 연결이 이미 닫혔으면 처리하지 않음
          if (isClosed) {
            return;
          }

          const [messages, ideas] = await Promise.all([
            getChatHistory(teamId),
            getIdeas(teamId),
          ]);

          // 메시지 변화 감지 (최신 메시지의 타임스탬프 비교)
          const latestMessageTimestamp =
            messages.length > 0 ? messages[messages.length - 1].timestamp : "";
          const messageChanged =
            latestMessageTimestamp !== lastMessageTimestamp;

          // 아이디어 변화 감지 (아이디어 내용 및 평가 변화 포함)
          const ideaContentHash = JSON.stringify(
            ideas.map((idea) => ({
              id: idea.id,
              timestamp: idea.timestamp,
              evaluationCount: idea.evaluations.length,
              lastEvaluationTimestamp:
                idea.evaluations.length > 0
                  ? idea.evaluations[idea.evaluations.length - 1].timestamp
                  : "",
            }))
          );
          const ideaChanged = ideaContentHash !== lastIdeaTimestamp;

          if (messageChanged || ideaChanged) {
            console.log("🔄 변화 감지 - 업데이트 전송:", {
              messageChanged,
              ideaChanged,
              messageCount: messages.length,
              ideaCount: ideas.length,
              latestMessageTimestamp,
            });

            // 연결이 닫혔는지 다시 한번 체크
            if (isClosed) {
              return;
            }

            try {
              controller.enqueue(
                `data: ${JSON.stringify({
                  type: "update",
                  messages: messageChanged ? messages : null,
                  ideas: ideaChanged ? ideas : null,
                  timestamp: new Date().toISOString(),
                })}\n\n`
              );

              lastMessageTimestamp = latestMessageTimestamp;
              lastIdeaTimestamp = ideaContentHash;
            } catch (enqueueError) {
              console.log("🔌 SSE 연결이 닫혔음 - enqueue 실패:", enqueueError instanceof Error ? enqueueError.message : enqueueError);
              isClosed = true;
            }
          }
        } catch (error) {
          console.error("업데이트 체크 실패:", error);
          // 연결 문제인 경우 닫힌 것으로 표시
          if ((error as { code?: string } | null)?.code === 'ERR_INVALID_STATE') {
            isClosed = true;
          }
        }
      };

      // 1초마다 변화 체크 (더 빠른 응답)
      const interval = setInterval(checkForUpdates, 1000);

      // 연결 종료 시 정리
      request.signal.addEventListener("abort", () => {
        console.log("🔌 SSE 연결 종료:", teamId);
        isClosed = true;
        clearInterval(interval);
        controller.close();
      });

      // 하트비트 (30초마다)
      const heartbeat = setInterval(() => {
        if (!isClosed) {
          try {
            controller.enqueue(
              `data: ${JSON.stringify({ type: "heartbeat" })}\n\n`
            );
          } catch (enqueueError) {
            console.log("🔌 하트비트 실패 - 연결 닫힘:", enqueueError instanceof Error ? enqueueError.message : enqueueError);
            isClosed = true;
          }
        }
      }, 30000);

      request.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
      });
    },
  });

  return new NextResponse(stream, { headers });
}
