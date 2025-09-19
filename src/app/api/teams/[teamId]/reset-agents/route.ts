import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { resetAllAgentStates, resetAgentState } from "@/lib/reset-agent-states";

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
    const { action, agentId } = body;

    if (action === "reset_all") {
      console.log(`🔧 관리자 요청: 팀 ${teamId} 모든 에이전트 상태 초기화`);

      const result = await resetAllAgentStates(teamId);

      if (result.success) {
        return NextResponse.json({
          success: true,
          message: `${result.agentsReset}개 에이전트와 ${result.sessionsCleared}개 세션이 초기화되었습니다.`,
          details: result,
        });
      } else {
        return NextResponse.json(
          { error: "초기화 실패: " + result.error },
          { status: 500 }
        );
      }
    } else if (action === "reset_agent" && agentId) {
      console.log(`🔧 관리자 요청: 에이전트 ${agentId} 상태 초기화`);

      const result = await resetAgentState(teamId, agentId);

      if (result.success) {
        return NextResponse.json({
          success: true,
          message: `에이전트 ${agentId}가 초기화되었습니다.`,
        });
      } else {
        return NextResponse.json(
          { error: "초기화 실패: " + result.error },
          { status: 500 }
        );
      }
    } else {
      return NextResponse.json(
        { error: "잘못된 액션입니다. 'reset_all' 또는 'reset_agent'를 사용하세요." },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error("에이전트 상태 초기화 오류:", error);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}