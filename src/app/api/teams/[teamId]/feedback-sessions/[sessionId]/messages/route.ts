import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { FeedbackSession, FeedbackSessionMessage } from "@/lib/types";

// 피드백 세션 메시지 전송
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ teamId: string; sessionId: string }> }
) {
  try {
    const { teamId, sessionId } = await params;
    const body = await request.json();
    const { sender, content, type = "message" } = body;

    // 세션 존재 확인
    const sessionData = await redis.get(`feedback_session:${sessionId}`);
    if (!sessionData) {
      return NextResponse.json(
        { error: "세션을 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    const session: FeedbackSession =
      typeof sessionData === "string" ? JSON.parse(sessionData) : sessionData;

    // 세션이 활성 상태인지 확인
    if (session.status !== "active") {
      return NextResponse.json(
        { error: "비활성 세션입니다." },
        { status: 400 }
      );
    }

    // 발송자가 세션 참가자인지 확인
    console.log(`🔍 메시지 발송자 확인: ${sender}`, {
      participants: session.participants.map(p => ({ id: p.id, name: p.name, isUser: p.isUser }))
    });

    const isParticipant = session.participants.some((p) => {
      // "Me", "user", 또는 실제 sender ID와 일치하는지 확인
      const match = (
        p.id === sender ||
        (sender === "Me" && (p.id === "Me" || p.id === "user" || p.isUser)) ||
        (sender === "user" && (p.id === "Me" || p.id === "user" || p.isUser))
      );

      if (match) {
        console.log(`✅ 참가자 매칭 성공: ${sender} → ${p.id} (isUser: ${p.isUser})`);
      }

      return match;
    });

    if (!isParticipant) {
      console.log("❌ 세션 참가자 확인 실패:", {
        sender,
        participants: session.participants.map((p) => ({
          id: p.id,
          name: p.name,
          isUser: p.isUser,
        })),
      });
      return NextResponse.json(
        { error: "세션 참가자가 아닙니다." },
        { status: 403 }
      );
    }

    // 새 메시지 생성
    const newMessage: FeedbackSessionMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      sender,
      content,
      timestamp: new Date().toISOString(),
      type,
    };

    // 세션에 메시지 추가
    session.messages.push(newMessage);

    // Redis에 업데이트된 세션 저장
    await redis.set(`feedback_session:${sessionId}`, JSON.stringify(session), {
      ex: 3600 * 24,
    });

    // 메모리 업데이트 - 각 참가자의 short-term memory에 활성 채팅 정보 저장
    // 🔒 피드백 세션 메시지는 processMemoryUpdate를 사용하지 않고 직접 처리
    const { handleFeedbackSessionMessage } = await import("@/lib/memory");

    for (const participant of session.participants) {
      try {
        await handleFeedbackSessionMessage({
          teamId,
          sessionId,
          participantId: participant.id,
          message: newMessage,
          otherParticipants: session.participants.filter(
            (p) => p.id !== participant.id
          ),
        });
      } catch (memoryError) {
        console.error(`메모리 업데이트 실패 (${participant.id}):`, memoryError);
      }
    }

    console.log(`📨 피드백 세션 메시지 전송 완료: ${sessionId}`, {
      messageId: newMessage.id,
      sender: newMessage.sender,
      content: newMessage.content.substring(0, 50) + "...",
      totalMessages: session.messages.length
    });

    // 상대방 에이전트의 응답 트리거 (AI 에이전트만)
    const otherParticipant = session.participants.find(p =>
      p.id !== sender && !p.isUser // 사용자가 아닌 다른 참가자
    );

    if (otherParticipant) {
      console.log(`🤖 ${otherParticipant.name} AI 응답 트리거 예약 (3초 후)`);

      // 3초 후 AI 응답 트리거
      setTimeout(async () => {
        try {
          console.log(`🚀 ${otherParticipant.name} AI 응답 생성 시작`);

          const { processAIFeedbackResponse } = await import("@/lib/ai-feedback-utils");

          const aiResponse = await processAIFeedbackResponse({
            teamId,
            sessionId,
            triggerAgentId: otherParticipant.id,
            action: "respond"
          });

          if (aiResponse.success) {
            console.log(`✅ ${otherParticipant.name} AI 응답 생성 완료`);
          } else {
            console.error(`❌ ${otherParticipant.name} AI 응답 생성 실패:`, aiResponse.error);
          }
        } catch (error) {
          console.error(`❌ ${otherParticipant.name} AI 응답 트리거 오류:`, error);
        }
      }, 3000);
    }

    return NextResponse.json({
      success: true,
      message: newMessage,
      session,
    });
  } catch (error) {
    console.error("피드백 세션 메시지 전송 실패:", error);
    return NextResponse.json(
      { error: "메시지 전송에 실패했습니다." },
      { status: 500 }
    );
  }
}

// 피드백 세션 메시지 조회
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ teamId: string; sessionId: string }> }
) {
  try {
    const { sessionId } = await params;

    // 세션 존재 확인
    const sessionData = await redis.get(`feedback_session:${sessionId}`);
    if (!sessionData) {
      return NextResponse.json(
        { error: "세션을 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    const session: FeedbackSession =
      typeof sessionData === "string" ? JSON.parse(sessionData) : sessionData;

    return NextResponse.json({
      messages: session.messages,
      session,
    });
  } catch (error) {
    console.error("피드백 세션 메시지 조회 실패:", error);
    return NextResponse.json(
      { error: "메시지 조회에 실패했습니다." },
      { status: 500 }
    );
  }
}
