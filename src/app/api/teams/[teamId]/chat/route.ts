import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { getChatHistory, addChatMessage } from "@/lib/redis";
import { processMemoryUpdate } from "@/lib/memory";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ teamId: string }> }
) {
  const session = await getServerSession();

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  try {
    const resolvedParams = await params;
    const messages = await getChatHistory(resolvedParams.teamId);
    return NextResponse.json({ messages });
  } catch (error) {
    console.error("Chat message retrieval error:", error);
    return NextResponse.json(
      { error: "Failed to load chat messages." },
      { status: 500 }
    );
  }
}

// 요청 데이터 생성 헬퍼 함수
function createRequestData(type: string, sender: string, session: any, messagePayload: any, teamId: string) {
  return {
    id: `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    type,
    requesterName: sender || session?.user?.email || "팀원",
    requesterId: sender || "Me",
    payload: {
      message: messagePayload.content,
      ...(type === "give_feedback" && { feedbackTarget: messagePayload.feedbackTarget }),
    },
    timestamp: new Date().toISOString(),
    teamId,
  };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ teamId: string }> }
) {
  const session = await getServerSession();

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  try {
    const resolvedParams = await params;
    const teamId = resolvedParams.teamId;
    const body = await request.json();
    const { sender, payload } = body;

    // payload 파싱 처리
    let parsedPayload = payload;

    if (typeof payload === 'string') {
      try {
        parsedPayload = JSON.parse(payload);
      } catch (error) {
        parsedPayload = { content: payload, type: "give_feedback" };
      }
    } else if (typeof payload === 'object' && payload !== null) {
      if (payload.type && payload.content && payload.mention) {
        parsedPayload = payload;
      }
    } else {
      parsedPayload = { content: String(payload), type: "give_feedback" };
    }

    const messageType = parsedPayload?.type || "give_feedback";
    const messagePayload = parsedPayload;

    const newMessage = await addChatMessage(teamId, {
      sender: sender || session.user.email,
      type: messageType,
      payload: messagePayload,
    });

    // 메모리 업데이트는 백그라운드에서 실행 (요청 처리 차단하지 않음)
    processMemoryUpdate({
      type: "CHAT_MESSAGE_SENT",
      payload: { teamId, senderId: sender || "Me", message: newMessage },
    }).catch(() => {}); // 에러 무시

    // 요청 처리
    if (messageType === "make_request" && messagePayload.requestType) {
      let requestType = "generate_idea";

      if (messagePayload.requestType === "evaluate" || messagePayload.requestType === "evaluate_idea") {
        requestType = "evaluate_idea";
      } else if (messagePayload.requestType === "give_feedback") {
        requestType = "give_feedback";
      }

      const requestData = createRequestData(requestType, sender, session, messagePayload, teamId);

      try {
        const { processRequestInBackground } = await import("@/lib/agent-background-processor");
        processRequestInBackground(teamId, messagePayload.mention, requestData);
      } catch (error) {
        console.error(`❌ 에이전트 요청 처리 실패:`, error);
      }
    }

    return NextResponse.json({ message: newMessage });
  } catch (error) {
    console.error("Chat message sending error:", error);
    return NextResponse.json(
      { error: "Failed to send message." },
      { status: 500 }
    );
  }
}
