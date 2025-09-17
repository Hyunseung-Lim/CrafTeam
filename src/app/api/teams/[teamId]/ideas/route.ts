import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import {
  getIdeas,
  addIdea,
  addChatMessage,
  getTeamById,
  getAgentById,
} from "@/lib/redis";
import {
  generateIdeaAction,
  preIdeationAction,
  executeIdeationAction,
} from "@/lib/openai";
import { startAgentStateSystem } from "@/actions/ideation.actions";
import { triggerMemoryUpdate } from "@/lib/memory-v2";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ teamId: string }> }
) {
  const session = await getServerSession();

  if (!session?.user?.email) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }

  try {
    const resolvedParams = await params;
    const ideas = await getIdeas(resolvedParams.teamId);
    return NextResponse.json({ ideas });
  } catch (error) {
    console.error("아이디어 조회 오류:", error);
    return NextResponse.json(
      { error: "아이디어를 불러오는데 실패했습니다." },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ teamId: string }> }
) {
  const session = await getServerSession();

  if (!session?.user?.email) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }

  try {
    const resolvedParams = await params;
    const teamId = resolvedParams.teamId;
    const body = await request.json();
    const { action, author, content, topic } = body;

    if (action === "generate") {
      // OpenAI API를 사용해서 실제 아이디어 생성
      try {
        let agentProfile = null;

        // 작성자가 "Me"가 아닌 경우 에이전트 프로필 가져오기
        if (author !== "Me") {
          agentProfile = await getAgentById(author);
        }

        const team = await getTeamById(teamId);

        const generatedContent = await generateIdeaAction(
          topic || "Carbon Emission Reduction",
          agentProfile,
          undefined,
          undefined,
          team
        );

        const newIdea = await addIdea(teamId, {
          author: author === "Me" ? "Me" : (author || session.user.email),
          timestamp: new Date().toISOString(),
          content: {
            object: (generatedContent as any).object || "Generated Idea",
            function: (generatedContent as any).function || "Function Description",
            behavior:
              typeof (generatedContent as any).behavior === "object"
                ? JSON.stringify((generatedContent as any).behavior)
                : (generatedContent as any).behavior || "Behavior Description",
            structure:
              typeof (generatedContent as any).structure === "object"
                ? JSON.stringify((generatedContent as any).structure)
                : (generatedContent as any).structure || "Structure Description",
          },
          evaluations: [],
        });

        // 시스템 메시지로 아이디어 생성 알림
        await addChatMessage(teamId, {
          sender: author || session.user.email,
          type: "system",
          payload: {
            content: "Generated a new idea.",
          },
        });

        // v2 메모리 업데이트 - 아이디어 생성 이벤트 기록 (AI 에이전트만)
        if (author && author !== "Me") {
          try {
            await triggerMemoryUpdate(
              author,
              "idea_evaluation", // 사용자 요청으로 아이디어 생성
              `Generated a new idea: "${newIdea.content.object}" - ${newIdea.content.function}`,
              undefined,
              teamId
            );
            console.log(
              `✅ 아이디어 생성 후 v2 메모리 업데이트 성공: ${author} -> idea ${newIdea.id}`
            );
          } catch (memoryError) {
            console.error(
              "❌ 아이디어 생성 후 v2 메모리 업데이트 실패:",
              memoryError
            );
            // 메모리 업데이트 실패는 아이디어 생성 성공에 영향을 주지 않음
          }
        }

        return NextResponse.json({ idea: newIdea });
      } catch (error) {
        console.error("AI 아이디어 생성 오류:", error);
        // 실패시 기본 아이디어로 대체
        const newIdea = await addIdea(teamId, {
          author: author === "Me" ? "Me" : (author || session.user.email),
          timestamp: new Date().toISOString(),
          content: {
            object: "AI 기반 환경 보호 솔루션",
            function:
              "사용자의 일상 활동을 분석하여 개인화된 환경 보호 제안을 제공하는 AI 시스템",
            behavior:
              "사용자 데이터를 학습하고 실시간으로 환경 친화적인 행동을 권장합니다",
            structure:
              "AI 엔진, 데이터 분석 모듈, 사용자 인터페이스, 추천 시스템으로 구성",
          },
          evaluations: [],
        });

        // v2 메모리 업데이트 - 기본 아이디어 생성 (AI 에이전트만)
        if (author && author !== "Me") {
          try {
            await triggerMemoryUpdate(
              author,
              "idea_evaluation",
              `Generated a new idea: "${newIdea.content.object}" - ${newIdea.content.function}`,
              undefined,
              teamId
            );
          } catch (memoryError) {
            console.error(
              "❌ 기본 아이디어 생성 후 v2 메모리 업데이트 실패:",
              memoryError
            );
          }
        }

        return NextResponse.json({ idea: newIdea });
      }
    }

    if (action === "add") {
      // 사용자가 수동으로 추가하는 아이디어
      console.log("🔍 [사용자 아이디어 추가] 전체 요청 데이터:", {
        action,
        author,
        content,
        contentKeys: Object.keys(content || {}),
        behaviorType: typeof content?.behavior,
        behaviorValue: content?.behavior,
        behaviorLength: content?.behavior?.length || 0,
        structureType: typeof content?.structure, 
        structureValue: content?.structure,
        structureLength: content?.structure?.length || 0,
        timestamp: new Date().toISOString()
      });
      
      const newIdea = await addIdea(teamId, {
        author: author || session.user.email,
        timestamp: new Date().toISOString(),
        content: {
          object: content.object || "",
          function: content.function || "",
          behavior: content.behavior || "",
          structure: content.structure || "",
        },
        evaluations: [],
      });
      
      console.log("🔍 [사용자 아이디어 추가] 저장된 아이디어:", newIdea);

      // v2 메모리 업데이트 - 수동 아이디어 추가 (AI 에이전트만)
      if (author && author !== "Me") {
        try {
          await triggerMemoryUpdate(
            author,
            "idea_evaluation",
            `Generated a new idea: "${newIdea.content.object}" - ${newIdea.content.function}`,
            undefined,
            teamId
          );
          console.log(
            `✅ 수동 아이디어 추가 후 v2 메모리 업데이트 성공: ${author} -> idea ${newIdea.id}`
          );
        } catch (memoryError) {
          console.error(
            "❌ 수동 아이디어 추가 후 v2 메모리 업데이트 실패:",
            memoryError
          );
        }
      }

      return NextResponse.json({ idea: newIdea });
    }

    if (action === "auto_generate") {
      // 자동 아이디어 생성
      const team = await getTeamById(teamId);
      if (!team) {
        return NextResponse.json(
          { error: "팀을 찾을 수 없습니다." },
          { status: 404 }
        );
      }

      // 아이디어 생성 역할을 가진 에이전트들 찾기
      const ideaGenerators = team.members.filter(
        (member) => !member.isUser && member.roles.includes("Idea Generation")
      );

      if (ideaGenerators.length === 0) {
        return NextResponse.json(
          { error: "아이디어 생성 역할을 가진 에이전트가 없습니다." },
          { status: 400 }
        );
      }

      console.log(
        `🚀 ${ideaGenerators.length}명의 에이전트가 아이디어 생성 시작`
      );

      // 모든 에이전트에 대해 병렬로 아이디어 생성
      const generationPromises = ideaGenerators.map(async (member) => {
        if (!member.agentId) return null;

        try {
          const agentProfile = await getAgentById(member.agentId);

          // 1. 계획 상태로 변경
          await updateAgentState(
            teamId,
            member.agentId,
            "plan",
            "planning",
            "아이디어 생성을 계획하고 있습니다",
            15
          );

          // 계획 시간 대기 (15초)
          await new Promise((resolve) => setTimeout(resolve, 15000));

          // 2. 작업 상태로 변경
          await updateAgentState(
            teamId,
            member.agentId,
            "action",
            "generate_idea",
            "창의적인 아이디어를 생성하고 있습니다",
            60
          );

          const team = await getTeamById(teamId);

          const generatedContent = await generateIdeaAction(
            topic || "Carbon Emission Reduction",
            agentProfile,
            undefined,
            undefined,
            team
          );

          const newIdea = await addIdea(teamId, {
            author: member.agentId,
            timestamp: new Date().toISOString(),
            content: {
              object: (generatedContent as any).object || "Generated Idea",
              function: (generatedContent as any).function || "Function Description",
              behavior:
                typeof (generatedContent as any).behavior === "object"
                  ? JSON.stringify((generatedContent as any).behavior)
                  : (generatedContent as any).behavior || "Behavior Description",
              structure:
                typeof (generatedContent as any).structure === "object"
                  ? JSON.stringify((generatedContent as any).structure)
                  : (generatedContent as any).structure || "Structure Description",
            },
            evaluations: [],
          });

          // 3. 완료 후 idle 상태로 변경
          await updateAgentState(teamId, member.agentId, "idle");

          // 시스템 메시지로 아이디어 생성 완료 알림
          await addChatMessage(teamId, {
            sender: member.agentId,
            type: "system",
            payload: {
              content: "Generated a new idea.",
            },
          });

          return { success: true, idea: newIdea };
        } catch (error) {
          console.error(
            `에이전트 ${member.agentId} 아이디어 생성 실패:`,
            error
          );

          // 오류 발생 시 idle 상태로 복구
          await updateAgentState(teamId, member.agentId, "idle");

          // 오류 발생 시 메시지
          await addChatMessage(teamId, {
            sender: member.agentId,
            type: "system",
            payload: {
              content: "아이디어 생성 중 오류가 발생했습니다",
            },
          });

          return { success: false, error: error };
        }
      });

      // 모든 생성 완료 대기
      const results = await Promise.all(generationPromises);
      const successCount = results.filter(
        (result: any) => result?.success
      ).length;

      console.log(
        `✅ 자동 아이디어 생성 완료: ${successCount}/${ideaGenerators.length}`
      );

      return NextResponse.json({
        success: true,
        message: `${successCount}개의 아이디어가 생성되었습니다.`,
        agentCount: ideaGenerators.length,
        generatingAgentIds: ideaGenerators
          .map((m) => m.agentId)
          .filter(Boolean),
      });
    }

    return NextResponse.json({ error: "잘못된 액션입니다." }, { status: 400 });
  } catch (error) {
    console.error("아이디어 API 오류:", error);
    return NextResponse.json(
      { error: "아이디어 API 처리 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

// 에이전트 상태 업데이트 함수 추가
async function updateAgentState(
  teamId: string,
  agentId: string,
  state: "idle" | "plan" | "action",
  taskType?: string,
  taskDescription?: string,
  estimatedDuration?: number
) {
  try {
    await fetch(
      `${
        process.env.NEXTAUTH_URL || "http://localhost:3000"
      }/api/teams/${teamId}/agent-states`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          agentId,
          currentState: state,
          taskType,
          taskDescription,
          estimatedDuration,
        }),
      }
    );
  } catch (error) {
    console.error(`에이전트 ${agentId} 상태 업데이트 실패:`, error);
  }
}
