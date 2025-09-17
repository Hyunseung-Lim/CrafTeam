import { NextRequest, NextResponse } from "next/server";
import {
  getTeamById,
  addIdea,
  getAgentMemory,
  updateAgentMemory,
} from "@/lib/redis";
import { generateIdeaAction } from "@/lib/openai";
import { getAgentById } from "@/lib/redis";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ teamId: string; agentId: string }> }
) {
  try {
    const { teamId, agentId } = await params;
    const body = await request.json();
    const { trigger, topic, teamContext } = body;

    console.log(`🎯 에이전트 ${agentId} 아이디어 생성 요청:`, {
      trigger,
      topic,
    });

    // 팀 정보 가져오기
    const team = await getTeamById(teamId);
    if (!team) {
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }

    // 에이전트가 팀에 속해있는지 확인
    const teamMember = team.members.find(
      (member) => !member.isUser && member.agentId === agentId
    );
    if (!teamMember) {
      return NextResponse.json({ error: "Agent not in team" }, { status: 403 });
    }

    // 에이전트가 아이디어 생성 역할을 가지고 있는지 확인
    if (!teamMember.roles.includes("Idea Generation")) {
      return NextResponse.json(
        {
          error: "Agent does not have idea generation role",
        },
        { status: 403 }
      );
    }

    // 에이전트 메모리 및 프로필 가져오기
    const agentMemory = await getAgentMemory(agentId);
    const agentProfile = await getAgentById(agentId);

    // 아이디어 생성 요청
    const ideaResult = await generateIdeaAction(
      topic || team.topic || "Carbon Emission Reduction",
      agentProfile,
      [], // 기존 아이디어는 별도 로직에서 처리
      agentMemory || undefined
    );

    if (!ideaResult.success || !ideaResult.idea) {
      console.error(
        `❌ 에이전트 ${agentId} 아이디어 생성 실패:`,
        ideaResult.error
      );
      return NextResponse.json(
        {
          error: ideaResult.error || "Failed to generate idea",
        },
        { status: 500 }
      );
    }

    // 아이디어를 팀에 추가
    const savedIdea = await addIdea(teamId, {
      author: agentId,
      timestamp: new Date().toISOString(),
      content: ideaResult.idea,
      evaluations: [],
    });

    console.log(`✅ Agent ${agentId} idea generation completed:`, savedIdea.id);

    // Memory update (record generated idea)
    if (agentMemory && ideaResult.updatedMemory) {
      await updateAgentMemory(agentId, ideaResult.updatedMemory);
    }

    return NextResponse.json({
      success: true,
      idea: savedIdea,
      message: "Idea was successfully generated.",
    });
  } catch (error) {
    console.error("Idea generation API error:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
      },
      { status: 500 }
    );
  }
}
