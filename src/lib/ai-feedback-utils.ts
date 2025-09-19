import { redis } from "@/lib/redis";
import { FeedbackSession } from "@/lib/types";
import { getAgentById } from "@/lib/redis";
import { generateFeedbackSessionResponse } from "@/lib/openai";

// Direct AI feedback response processing function
export async function processAIFeedbackResponse({
  teamId,
  sessionId,
  triggerAgentId,
  action,
}: {
  teamId: string;
  sessionId: string;
  triggerAgentId: string;
  action: string;
}) {
  try {
    console.log("🤖 [AI처리] 피드백 AI 응답 처리 시작:", {
      teamId,
      sessionId,
      triggerAgentId,
      action,
    });

    // 세션 정보 조회
    const sessionData = await redis.get(`feedback_session:${sessionId}`);
    if (!sessionData) {
      return {
        success: false,
        error: "세션을 찾을 수 없습니다.",
      };
    }

    const session: FeedbackSession =
      typeof sessionData === "string" ? JSON.parse(sessionData) : sessionData;

    if (session.status !== "active") {
      return {
        success: false,
        error: "세션이 비활성 상태입니다.",
      };
    }

    // 에이전트 정보 조회
    const agentData = await getAgentById(triggerAgentId);
    if (!agentData) {
      return {
        success: false,
        error: "에이전트를 찾을 수 없습니다.",
      };
    }

    console.log(`🤖 [AI처리] ${agentData.name} AI 응답 생성 중...`);

    // AI 응답 생성
    const otherParticipant = session.participants.find(p => p.id !== triggerAgentId);
    if (!otherParticipant) {
      return {
        success: false,
        error: "다른 참가자를 찾을 수 없습니다.",
      };
    }

    const responseContent = await generateFeedbackSessionResponse(
      agentData,
      {
        sessionId,
        otherParticipant,
        messageHistory: session.messages,
        feedbackContext: session.feedbackContext,
      }
    );

    if (!responseContent) {
      return {
        success: false,
        error: "AI 응답을 생성할 수 없습니다.",
      };
    }

    // 새 메시지 생성
    const aiMessage = {
      id: `msg_${Date.now()}_ai_${Math.random().toString(36).substring(2, 11)}`,
      sender: triggerAgentId,
      content: typeof responseContent === 'string' ? responseContent : responseContent.response,
      timestamp: new Date().toISOString(),
      type: "message" as const,
    };

    // 세션에 메시지 추가
    session.messages.push(aiMessage);
    session.lastActivityAt = new Date().toISOString();

    // Redis에 업데이트된 세션 저장
    await redis.set(
      `feedback_session:${sessionId}`,
      JSON.stringify(session),
      { ex: 3600 * 24 }
    );

    console.log(`✅ [AI처리] ${agentData.name} AI 응답 생성 완료: ${aiMessage.id}`);

    return {
      success: true,
      message: aiMessage,
      sessionEnded: false,
    };
  } catch (error) {
    console.error("❌ [AI처리] AI 피드백 응답 처리 실패:", error);
    return {
      success: false,
      error: "AI 응답 처리에 실패했습니다.",
    };
  }
}