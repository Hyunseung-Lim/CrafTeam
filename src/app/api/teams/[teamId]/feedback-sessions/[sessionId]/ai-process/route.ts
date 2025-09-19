import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { FeedbackSession, FeedbackSessionMessage } from "@/lib/types";
import {
  generateFeedbackSessionResponse,
  generateFeedbackSessionSummary,
} from "@/lib/openai";
import { getAgentById, getAgentMemory } from "@/lib/redis";
import { processMemoryUpdate } from "@/lib/memory";
import { getBaseUrlFromNextRequest } from "@/lib/api-utils";

// AI 에이전트 피드백 세션 처리
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ teamId: string; sessionId: string }> }
) {
  try {
    const { teamId, sessionId } = await params;
    const body = await request.json();
    const { triggerAgentId, action } = body;

    if (action === "respond") {
      // AI 에이전트가 피드백 세션에서 응답 생성
      console.log(
        `🤖 AI 피드백 세션 응답 처리 시작: ${triggerAgentId} in ${sessionId}`
      );

      // 세션 정보 가져오기
      console.log(`🔍 세션 정보 조회 시작: ${sessionId}`);
      const sessionData = await redis.get(`feedback_session:${sessionId}`);
      if (!sessionData) {
        console.error(`❌ 세션을 찾을 수 없음: ${sessionId}`);
        return NextResponse.json(
          { error: "세션을 찾을 수 없습니다." },
          { status: 404 }
        );
      }
      console.log(`✅ 세션 정보 조회 성공: ${sessionId}`);

      const session: FeedbackSession =
        typeof sessionData === "string" ? JSON.parse(sessionData) : sessionData;

      // 세션이 활성 상태인지 확인
      console.log(`🔍 세션 상태 확인: ${session.status}`);
      if (session.status !== "active") {
        console.error(`❌ 비활성 세션: ${sessionId}, 상태: ${session.status}`);
        return NextResponse.json(
          { error: "비활성 세션입니다." },
          { status: 400 }
        );
      }

      // 에이전트가 세션 참가자인지 확인
      console.log(`🔍 참가자 확인: ${triggerAgentId}`, {
        participants: session.participants.map((p) => ({
          id: p.id,
          name: p.name,
        })),
      });
      const isParticipant = session.participants.some(
        (p) => p.id === triggerAgentId
      );
      if (!isParticipant) {
        console.error(`❌ 세션 참가자가 아님: ${triggerAgentId}`);
        return NextResponse.json(
          { error: "세션 참가자가 아닙니다." },
          { status: 403 }
        );
      }
      console.log(`✅ 참가자 확인 완료: ${triggerAgentId}`);

      // 에이전트 정보 가져오기
      console.log(`🔍 에이전트 정보 조회 시작: ${triggerAgentId}`);
      const agent = await getAgentById(triggerAgentId);
      if (!agent) {
        console.error(`❌ 에이전트를 찾을 수 없음: ${triggerAgentId}`);
        return NextResponse.json(
          { error: "에이전트를 찾을 수 없습니다." },
          { status: 404 }
        );
      }
      console.log(
        `✅ 에이전트 정보 조회 성공: ${agent.name} (${triggerAgentId})`
      );

      // 상대방 찾기
      const otherParticipant = session.participants.find(
        (p) => p.id !== triggerAgentId
      );
      if (!otherParticipant) {
        return NextResponse.json(
          { error: "상대방을 찾을 수 없습니다." },
          { status: 404 }
        );
      }

      // 에이전트 메모리 가져오기
      const agentMemory = await getAgentMemory(triggerAgentId);

      // 현재 팀의 아이디어 목록 가져오기
      const { getIdeas } = await import("@/lib/redis");
      const teamIdeas = await getIdeas(teamId);

      // 팀 정보 및 상대방 역할/아이디어 조회
      const { getTeamById } = await import("@/lib/redis");
      const team = await getTeamById(teamId);
      
      let targetMemberRoles: string[] = [];
      let targetMemberIdeas: any[] = [];
      
      if (team) {
        // 상대방의 역할 조회
        const targetMember = team.members.find(m => 
          (m.agentId && m.agentId === otherParticipant.id) || 
          ((m as any).userId && (m as any).userId === otherParticipant.id)
        );
        if (targetMember) {
          targetMemberRoles = targetMember.roles || [];
        }
        
        // 상대방의 아이디어 조회 (ID와 이름 모두 확인)
        targetMemberIdeas = teamIdeas.filter(idea => 
          idea.author === otherParticipant.name || 
          idea.author === otherParticipant.id ||
          (idea as any).authorId === otherParticipant.id ||
          (idea as any).authorId === otherParticipant.name
        );
      }

      // AI 응답 생성
      const responseResult = await generateFeedbackSessionResponse(
        agent,
        {
          sessionId,
          otherParticipant,
          messageHistory: session.messages,
          feedbackContext: session.feedbackContext,
          teamIdeas,
          targetMemberRoles,
          targetMemberIdeas,
          team,
          teamContext: { 
            topic: team?.topic, 
            teamMembers: team?.members, 
            relationships: team?.relationships 
          },
          teamTopic: team?.topic,
          allIdeas: teamIdeas,
        },
        agentMemory
      );

      // 실제 대화 메시지 수 확인 (디버깅용)
      const actualMessageCount = session.messages.filter(
        (msg) => msg.type === "message"
      ).length;

      console.log(`🎯 AI 응답 생성 결과:`, {
        agent: agent.name,
        totalMessages: session.messages.length,
        actualMessages: actualMessageCount,
        shouldEnd: responseResult.shouldEnd,
        reasoning: responseResult.reasoning,
        response: responseResult.response.substring(0, 50) + "...",
      });

      // 응답 메시지 생성
      const responseMessage: FeedbackSessionMessage = {
        id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        sender: triggerAgentId,
        content: responseResult.response,
        timestamp: new Date().toISOString(),
        type: "message",
      };

      // 세션에 메시지 추가
      session.messages.push(responseMessage);

      // 세션 상태 업데이트
      session.lastActivityAt = new Date().toISOString();

      // 첫 번째 메시지인 경우 피드백 제공자를 feedback_session 상태로 변경
      if (session.messages.length === 1) {
        console.log(
          `💬 ${agent.name} 첫 피드백 메시지 생성 - feedback_session 상태로 변경`
        );

        try {
          const baseUrl = getBaseUrlFromNextRequest(request);
          const response = await fetch(
            `${baseUrl}/api/teams/${teamId}/agent-states`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "User-Agent": "TeamBuilder-Internal",
              },
              body: JSON.stringify({
                agentId: triggerAgentId,
                currentState: "feedback_session",
                taskType: "feedback_session",
                taskDescription: `${otherParticipant.name}와 피드백 세션 진행 중`,
                estimatedDuration: 300, // 5분 예상
                trigger: "autonomous",
                sessionInfo: {
                  sessionId,
                  participants: session.participants.map((p) => p.name),
                },
              }),
            }
          );

          if (response.ok) {
            console.log(`✅ ${agent.name} 상태가 feedback_session으로 변경됨`);
          } else {
            console.error(
              `❌ ${agent.name} feedback_session 상태 변경 실패:`,
              response.status
            );
          }
        } catch (error) {
          console.error(
            `❌ ${agent.name} feedback_session 상태 변경 오류:`,
            error
          );
        }
      }

      // 세션 종료 처리
      if (responseResult.shouldEnd) {
        console.log(
          `🏁 AI가 피드백 세션 종료 결정: ${sessionId} (에이전트: ${agent.name})`
        );

        session.status = "completed";
        session.endedAt = new Date().toISOString();
        session.endedBy = "ai"; // AI가 종료했음을 명시

        // 피드백 세션 종료 API 호출로 통합 처리
        try {
          const baseUrl = getBaseUrlFromNextRequest(request);
          const endResponse = await fetch(
            `${baseUrl}/api/teams/${teamId}/feedback-sessions`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "User-Agent": "TeamBuilder-Internal",
              },
              body: JSON.stringify({
                action: "end",
                sessionId: sessionId,
                endedBy: "ai", // AI가 종료했음을 명시
              }),
            }
          );

          if (endResponse.ok) {
            console.log(`✅ AI 피드백 세션 종료 API 호출 성공: ${sessionId}`);
            
            // API 호출이 성공했으면 업데이트된 세션 정보 가져오기
            const endResult = await endResponse.json();
            const updatedSession = endResult.session || session;
            
            console.log(`✅ AI 피드백 세션 종료 완료: ${sessionId}, 최종 상태: ${updatedSession.status}`);

            return NextResponse.json({
              success: true,
              message: responseMessage,
              sessionEnded: true,
              session: updatedSession, // 업데이트된 세션 사용
            });
          } else {
            console.error(
              `❌ AI 피드백 세션 종료 API 호출 실패:`,
              endResponse.status
            );
          }
        } catch (endError) {
          console.error(`❌ AI 피드백 세션 종료 API 호출 오류:`, endError);
        }

        // 기존 로직으로 폴백 (API 호출 실패 시)
        console.log(`🔄 기존 로직으로 피드백 세션 종료 처리: ${sessionId}`);

        // 피드백 세션 요약 생성
        console.log(`📋 피드백 세션 요약 생성 중: ${sessionId}`);

        const summary = await generateFeedbackSessionSummary(
          session.messages,
          session.participants
        );

        // 요약을 세션에 저장
        session.summary = summary as any;

        // 각 참가자의 메모리에 요약 저장
        for (const participant of session.participants) {
          if (!participant.isUser) {
            try {
              await processMemoryUpdate({
                type: "FEEDBACK_SESSION_COMPLETED",
                payload: {
                  teamId,
                  sessionId,
                  participantId: participant.id,
                  otherParticipant: session.participants.find(
                    (p) => p.id !== participant.id
                  ),
                  summary: summary.summary,
                  keyInsights: summary.keyInsights,
                  messageCount: session.messages.length,
                } as any,
              });

              console.log(
                `✅ 참가자 ${participant.name}의 메모리 업데이트 완료`
              );
            } catch (memoryError) {
              console.error(
                `❌ 참가자 ${participant.name}의 메모리 업데이트 실패:`,
                memoryError
              );
            }
          }
        }

        // 팀 채팅에 피드백 세션 완료 알림 및 요약 공개
        const { addChatMessage } = await import("@/lib/redis");

        console.log(`📋 피드백 세션 메시지 전송 전 확인:`, {
          sessionMessages: session.messages,
          messageCount: session.messages.length,
        });

        // 중복 체크를 위해 고유한 요약 ID 생성
        const summaryId = `${sessionId}_summary`;

        // 이미 해당 세션의 요약이 팀 채팅에 있는지 확인
        const existingSummaryCheck = await redis.get(
          `summary_check:${summaryId}`
        );
        if (existingSummaryCheck) {
          console.log(
            `⚠️ 세션 ${sessionId}의 요약이 이미 생성되었습니다. (AI 종료)`
          );
        } else {
          // 직접 addChatMessage 함수 호출 (인증 문제 해결)
          try {
            await addChatMessage(teamId, {
              sender: "system",
              type: "feedback_session_summary",
              payload: {
                type: "feedback_session_summary",
                sessionId,
                participants: session.participants.map((p) => p.name),
                summary: summary.summary,
                keyInsights: summary.keyInsights,
                messageCount: session.messages.length,
                duration: session.endedAt
                  ? Math.round(
                      (new Date(session.endedAt).getTime() -
                        new Date(session.createdAt).getTime()) /
                        1000 /
                        60
                    )
                  : 0,
                sessionMessages: session.messages,
                endedBy: session.endedBy, // 종료 주체 정보 추가
              },
            });

            console.log(`✅ 피드백 세션 요약이 팀 채팅에 공개됨: ${sessionId}`);

            // 요약 생성 완료 표시 (1시간 후 자동 삭제)
            await redis.set(`summary_check:${summaryId}`, "completed", {
              ex: 3600,
            });
          } catch (chatError) {
            console.error("❌ 피드백 세션 요약 채팅 추가 실패:", chatError);
          }
        }

        // 활성 세션 목록에서 제거
        const activeSessionsKey = `team:${teamId}:active_feedback_sessions`;
        await redis.srem(activeSessionsKey, sessionId);

        // 참가자들의 에이전트 상태를 idle로 되돌리기 (에러 무시)
        for (const participant of session.participants) {
          if (!participant.isUser && participant.id !== "Me") {
            try {
              const baseUrl =
                getBaseUrlFromNextRequest(request);
              const response = await fetch(
                `${baseUrl}/api/teams/${teamId}/agent-states`,
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "User-Agent": "TeamBuilder-Internal",
                  },
                  body: JSON.stringify({
                    agentId: participant.id,
                    currentState: "idle",
                  }),
                }
              );

              if (response.ok) {
                console.log(
                  `✅ 에이전트 ${participant.id} 상태가 idle로 변경됨`
                );
              } else {
                console.warn(
                  `⚠️ 에이전트 ${participant.id} idle 상태 변경 실패: ${response.status} (무시됨)`
                );
              }
            } catch (error) {
              console.warn(
                `⚠️ 에이전트 ${participant.id} idle 상태 변경 오류: ${error} (무시됨)`
              );
            }
          }
        }

        // 세션 저장
        await redis.set(
          `feedback_session:${sessionId}`,
          JSON.stringify(session),
          { ex: 3600 * 24 * 7 } // 7일 보관
        );

        return NextResponse.json({
          success: true,
          message: responseMessage,
          sessionEnded: true,
          session,
          summary: summary,
        });
      } else {
        // 세션 계속 진행 - 저장
        await redis.set(
          `feedback_session:${sessionId}`,
          JSON.stringify(session),
          { ex: 3600 * 24 }
        );

        // 🔄 세션이 계속 진행되는 경우 - AI 에이전트 상태를 feedback_session으로 확실히 유지
        console.log(
          `🔄 ${agent.name} 피드백 세션 계속 진행 - feedback_session 상태 유지 확인`
        );

        try {
          const { setAgentState } = await import("@/lib/agent-state-utils");

          await setAgentState(teamId, triggerAgentId, {
            agentId: triggerAgentId,
            currentState: "feedback_session",
            lastStateChange: new Date().toISOString(),
            isProcessing: true,
            currentTask: {
              type: "feedback_session",
              description: `${otherParticipant.name}와 피드백 세션 진행 중`,
              startedAt: new Date().toISOString(),
              sessionInfo: {
                sessionId,
                participants: session.participants.map((p) => p.name),
              },
            },
          });

          console.log(`✅ ${agent.name} 피드백 세션 상태 유지 확인 완료`);
        } catch (stateError) {
          console.warn(
            `⚠️ ${agent.name} 피드백 세션 상태 유지 오류:`,
            stateError
          );
        }

        // 메모리 업데이트 - 메시지 추가
        // 🔒 피드백 세션 메시지는 processMemoryUpdate를 사용하지 않고 직접 처리
        const { handleFeedbackSessionMessage } = await import("@/lib/memory");

        try {
          await handleFeedbackSessionMessage({
            teamId,
            sessionId,
            participantId: triggerAgentId,
            message: responseMessage,
            otherParticipants: [otherParticipant],
          });
        } catch (memoryError) {
          console.error(
            "피드백 세션 메시지 메모리 업데이트 실패:",
            memoryError
          );
        }

        console.log(`💬 AI 피드백 세션 응답 완료: ${sessionId}`);

        // AI-AI 세션인 경우 상대방도 자동으로 응답하도록 트리거
        if (!otherParticipant.isUser && otherParticipant.id !== "Me") {
          console.log(
            `🔄 AI-AI 세션 - 상대방 ${otherParticipant.name} 자동 응답 트리거`
          );

          // 3초 후 상대방 응답 트리거 (비동기)
          setTimeout(async () => {
            try {
              console.log(`🤖 ${otherParticipant.name} 자동 응답 생성 시작`);

              const counterResponse = await fetch(
                `${
                  getBaseUrlFromNextRequest(request)
                }/api/teams/${teamId}/feedback-sessions/${sessionId}/ai-process`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    triggerAgentId: otherParticipant.id,
                    action: "respond",
                  }),
                }
              );

              if (counterResponse.ok) {
                const counterData = await counterResponse.json();
                console.log(`✅ ${otherParticipant.name} 자동 응답 완료`);

                // 세션이 종료되지 않았고 메시지가 아직 적으면 계속 응답
                if (
                  !counterData.sessionEnded &&
                  counterData.session?.messages?.length < 8
                ) {
                  console.log(
                    `🔄 AI-AI 대화 계속 진행 중 (${counterData.session?.messages?.length}개 메시지)`
                  );
                }
              } else {
                console.error(
                  `❌ ${otherParticipant.name} 자동 응답 실패:`,
                  counterResponse.status
                );
              }
            } catch (error) {
              console.error(
                `❌ ${otherParticipant.name} 자동 응답 오류:`,
                error
              );
            }
          }, 3000); // 3초 후 응답
        }

        return NextResponse.json({
          success: true,
          message: responseMessage,
          sessionEnded: false,
          session,
        });
      }
    }

    return NextResponse.json({ error: "잘못된 액션입니다." }, { status: 400 });
  } catch (error) {
    console.error("AI 피드백 세션 처리 실패:", error);
    return NextResponse.json(
      { error: "AI 피드백 세션 처리에 실패했습니다." },
      { status: 500 }
    );
  }
}
