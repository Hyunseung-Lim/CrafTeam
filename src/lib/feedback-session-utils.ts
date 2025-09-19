import { redis } from "@/lib/redis";
import {
  FeedbackSession,
  FeedbackSessionParticipant,
  FeedbackSessionMessage,
  FeedbackSessionStatus,
} from "@/lib/types";
import { getTeamById, getAgentById, addChatMessage } from "@/lib/redis";
import { getAgentState, setAgentState, createNewIdleTimer } from "@/lib/agent-state-utils";
import { canCreateFeedbackSession } from "@/lib/relationship-utils";
import { findMemberById, getMemberActualId } from "@/lib/member-utils";

// Direct feedback session creation function
export async function createFeedbackSessionDirect({
  teamId,
  initiatorId,
  targetAgentId,
  message,
  feedbackContext,
}: {
  teamId: string;
  initiatorId: string;
  targetAgentId: string;
  message?: string;
  feedbackContext: {
    type: string;
    initiatedBy: string;
    description: string;
  };
}) {
  try {
    // 필수 필드 검증
    if (!initiatorId || !targetAgentId || !feedbackContext) {
      console.error("❌ 필수 필드 누락:", {
        initiatorId,
        targetAgentId,
        feedbackContext,
      });
      return {
        success: false,
        error: "initiatorId, targetAgentId, feedbackContext is required",
      };
    }

    // 🔒 관계 기반 피드백 세션 생성 권한 확인
    const team = await getTeamById(teamId);
    if (!team) {
      return {
        success: false,
        error: "팀을 찾을 수 없습니다.",
      };
    }

    // 대상 멤버 ID 해결 (중앙화된 유틸리티 사용)
    const targetMember = findMemberById(team, targetAgentId);
    if (!targetMember) {
      return {
        success: false,
        error: `팀원 "${targetAgentId}"를 찾을 수 없습니다.`,
      };
    }

    const resolvedTargetId = getMemberActualId(targetMember);

    // 관계 확인
    const hasRelationship = canCreateFeedbackSession(initiatorId, resolvedTargetId, team);
    if (!hasRelationship) {
      return {
        success: false,
        error: "피드백 세션을 생성할 권한이 없습니다. 관계가 연결된 팀원과만 피드백 세션을 생성할 수 있습니다.",
        relationshipRequired: true,
      };
    }

    console.log("✅ 관계 기반 피드백 세션 생성 권한 확인 완료");

    // 🔒 피드백 세션 중복 방지를 위한 상태 확인
    console.log("🔍 참가자들의 피드백 세션 상태 확인 중...");

    // 공통 상태 확인 함수 - 실제 활성 세션만 확인 (기존 패턴 사용)
    const checkParticipantSession = async (participantId: string, role: string) => {
      // 기존 active 세션 조회 로직과 동일한 패턴 사용
      const activeSessionIds = await redis.smembers(
        `team:${teamId}:active_feedback_sessions`
      );

      const sessionsToRemove = [];

      for (const sessionId of activeSessionIds) {
        const sessionData = await redis.get(`feedback_session:${sessionId}`);
        if (sessionData) {
          const session: FeedbackSession =
            typeof sessionData === "string"
              ? JSON.parse(sessionData)
              : sessionData;

          // 실제로 활성 상태이고 해당 참가자가 포함된 세션인지 확인
          if (session.status === "active") {
            const isParticipant = session.participants.some(p => p.id === participantId);
            if (isParticipant) {
              console.log(`❌ ${role}(${participantId})가 이미 피드백 세션 중 (세션 ID: ${sessionId})`);
              return true;
            }
          } else {
            // 비활성 세션이면 active 목록에서 제거 대상으로 표시
            console.log(`🧹 비활성 세션 ${sessionId} (상태: ${session.status}) 정리 대상 발견`);
            sessionsToRemove.push(sessionId);
          }
        } else {
          // 세션 데이터가 없으면 active 목록에서 제거 대상으로 표시
          console.log(`🧹 존재하지 않는 세션 ${sessionId} 정리 대상 발견`);
          sessionsToRemove.push(sessionId);
        }
      }

      // 오래된 세션들을 active 목록에서 제거
      if (sessionsToRemove.length > 0) {
        console.log(`🧹 ${sessionsToRemove.length}개 오래된 세션을 active 목록에서 제거 중...`);
        for (const sessionId of sessionsToRemove) {
          await redis.srem(`team:${teamId}:active_feedback_sessions`, sessionId);
        }
        console.log(`✅ 오래된 세션 정리 완료`);
      }

      return false;
    };

    // 참가자 상태 확인
    const [initiatorInSession, targetInSession] = await Promise.all([
      checkParticipantSession(initiatorId, "시작자"),
      checkParticipantSession(targetAgentId, "대상자")
    ]);

    // 3. 피드백 세션 중인 참가자가 있으면 생성 거부
    if (initiatorInSession) {
      return {
        success: false,
        error: "현재 다른 피드백 세션에 참여 중입니다.",
        busy: true,
        reason: "initiator_busy",
      };
    }

    if (targetInSession) {
      const targetAgentData =
        targetAgentId !== "Me" ? await getAgentById(targetAgentId) : null;
      const targetName =
        targetAgentId === "Me"
          ? "Me"
          : targetAgentData?.name || targetAgentId;

      return {
        success: false,
        error: `${targetName}는 현재 다른 피드백 세션에 참여 중입니다.`,
        busy: true,
        reason: "target_busy",
      };
    }

    console.log("✅ 모든 참가자가 피드백 세션 참여 가능한 상태");

    // 사용자 실제 이름 가져오기 (ChatArea 패턴 사용)
    const userMember = team.members.find(m => m.isUser);
    const userName = userMember?.userProfile?.name || "Me";

    // 에이전트 해결 공통 함수
    const resolveAgent = async (agentId: string) => {
      if (agentId === "Me") {
        return { id: "Me", data: null };
      }

      // 먼저 ID로 시도
      let agentData = await getAgentById(agentId);

      if (!agentData) {
        // ID로 찾지 못한 경우, 팀 정보를 가져와서 이름으로 검색
        console.log(`🔍 에이전트 ${agentId}를 ID로 찾을 수 없음. 이름으로 검색 중...`);

        const team = await getTeamById(teamId);
        if (team) {
          for (const member of team.members) {
            if (!member.isUser && member.agentId) {
              const agent = await getAgentById(member.agentId);
              if (agent && agent.name === agentId) {
                console.log(`✅ 이름 "${agentId}"로 에이전트 "${member.agentId}" 찾음`);
                return { id: member.agentId, data: agent };
              }
            }
          }
        }

        console.error(`❌ 에이전트 "${agentId}"를 찾을 수 없음 (ID나 이름으로도 없음)`);
        return null;
      }

      return { id: agentId, data: agentData };
    };

    const targetAgent = await resolveAgent(targetAgentId);
    if (!targetAgent) {
      return {
        success: false,
        error: `에이전트 "${targetAgentId}"를 찾을 수 없습니다.`,
      };
    }

    const resolvedTargetAgentId = targetAgent.id;
    const targetAgentData = targetAgent.data;

    // 피드백 세션 생성
    const sessionId = `feedback_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

    const participants = [
      {
        id: initiatorId,
        name: initiatorId === "Me" ? userName : "AI Agent",
        isUser: initiatorId === "Me",
        joinedAt: new Date().toISOString(),
      },
      {
        id: resolvedTargetAgentId,
        name:
          resolvedTargetAgentId === "Me"
            ? userName
            : targetAgentData?.name || "Target Agent",
        isUser: resolvedTargetAgentId === "Me",
        joinedAt: new Date().toISOString(),
      },
    ];

    // initiator 에이전트 이름 설정
    if (initiatorId !== "Me") {
      const initiatorAgent = await resolveAgent(initiatorId);
      if (initiatorAgent?.data) {
        participants[0].name = initiatorAgent.data.name;
      }
    }

    const session: FeedbackSession = {
      id: sessionId,
      teamId,
      participants,
      messages: [],
      status: "active",
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      feedbackContext: {
        category: feedbackContext.type,
        description: feedbackContext.description,
      },
      initiatedBy: initiatorId,
    };

    // Redis에 세션 저장
    await redis.set(
      `feedback_session:${sessionId}`,
      JSON.stringify(session),
      {
        ex: 3600 * 24, // 24시간 만료
      }
    );

    // 활성 세션 목록에 추가
    const activeSessionsKey = `team:${teamId}:active_feedback_sessions`;
    await redis.sadd(activeSessionsKey, sessionId);

    // 첫 번째 메시지를 시스템 메시지로 추가
    const initialMessage = {
      id: `msg_${Date.now()}_init`,
      sender: "system",
      content: "Feedback session has started.",
      timestamp: new Date().toISOString(),
      type: "system" as const,
    };

    session.messages.push(initialMessage);
    await redis.set(
      `feedback_session:${sessionId}`,
      JSON.stringify(session),
      {
        ex: 3600 * 24,
      }
    );

    console.log(`✅ 피드백 세션 생성 완료: ${sessionId}`);

    // 🔄 모든 참가자의 상태를 'feedback_session'으로 즉시 변경
    // 공통 상태 변경 함수
    const updateParticipantState = async (participantId: string, participantName: string, trigger: string) => {
      if (participantId !== "Me") {
        // AI 에이전트 상태 변경 - Direct function call
        try {
          await setAgentState(teamId, participantId, {
            agentId: participantId,
            currentState: "feedback_session",
            lastStateChange: new Date().toISOString(),
            isProcessing: true,
            currentTask: {
              type: "feedback_session",
              description: `${participantName}와 피드백 세션 진행 중`,
              startTime: new Date().toISOString(),
              estimatedDuration: 600,
              trigger: trigger as "user_request" | "autonomous",
              sessionInfo: {
                sessionId,
                participants: participants.map((p) => p.name),
              },
            },
          });

          console.log(`✅ ${participantName} 상태가 feedback_session으로 변경됨`);
          return true;
        } catch (error) {
          console.error(`❌ ${participantName} feedback_session 상태 변경 오류:`, error);
          return false;
        }
      } else {
        // 인간 사용자 상태 변경
        try {
          const userStateKey = `team:${teamId}:user_state`;
          const userState = {
            currentState: "feedback_session",
            taskType: "feedback_session",
            taskDescription: `${participantName}와 피드백 세션 진행 중`,
            estimatedDuration: 600,
            trigger,
            sessionInfo: {
              sessionId,
              participants: participants.map((p) => p.name),
            },
            startTime: new Date().toISOString(),
          };

          await redis.set(userStateKey, JSON.stringify(userState), {
            ex: 3600 * 24,
          });
          console.log(`✅ 인간 사용자 상태가 feedback_session으로 변경됨`);
          return true;
        } catch (error) {
          console.error(`❌ 인간 사용자 feedback_session 상태 변경 오류:`, error);
          return false;
        }
      }
    };

    // 병렬 상태 업데이트
    await Promise.all([
      updateParticipantState(initiatorId, participants[1].name, "user_request"),
      updateParticipantState(resolvedTargetAgentId, participants[0].name, initiatorId === "Me" ? "user_request" : "ai_initiated")
    ]);

    // 사용자가 첫 메시지를 남기는 경우 AI 응답 트리거
    console.log("🔍 [직접함수] AI 트리거 조건 확인:", {
      initiatorId,
      hasMessage: !!message,
      messageContent: message
    });

    if (initiatorId === "Me" && message) {
      const userMessage = {
        id: `msg_${Date.now()}_user`,
        sender: "Me",
        content: message,
        timestamp: new Date().toISOString(),
        type: "message" as const,
      };

      session.messages.push(userMessage);
      await redis.set(
        `feedback_session:${sessionId}`,
        JSON.stringify(session),
        {
          ex: 3600 * 24,
        }
      );

      // AI 응답 트리거 (비동기) - Direct function call
      console.log("🤖 [직접함수] 피드백 세션 생성 시 AI 응답 트리거 시작");
      setTimeout(async () => {
        try {
          const { processAIFeedbackResponse } = await import("@/lib/ai-feedback-utils");

          console.log("🤖 [직접함수] AI 응답 처리 시작");

          const result = await processAIFeedbackResponse({
            teamId,
            sessionId,
            triggerAgentId: resolvedTargetAgentId,
            action: "respond",
          });

          console.log("🤖 [직접함수] AI 응답 처리 결과:", result.success);

          if (result.success) {
            console.log(
              `✅ ${
                targetAgentData?.name || resolvedTargetAgentId
              } AI 응답 트리거 완료`
            );
          } else {
            console.error(
              `❌ ${
                targetAgentData?.name || resolvedTargetAgentId
              } AI 응답 트리거 실패:`,
              result.error
            );
          }
        } catch (error) {
          console.error(
            `❌ ${
              targetAgentData?.name || resolvedTargetAgentId
            } AI 응답 트리거 오류:`,
            error
          );
        }
      }, 2000); // 2초 후 응답
    }

    return {
      success: true,
      sessionId,
      session,
    };
  } catch (error) {
    console.error("피드백 세션 직접 생성 실패:", error);
    return {
      success: false,
      error: "피드백 세션 처리에 실패했습니다.",
    };
  }
}

// Direct feedback session end function
export async function endFeedbackSessionDirect({
  teamId,
  sessionId,
  endedBy = "ai",
}: {
  teamId: string;
  sessionId: string;
  endedBy?: "user" | "ai";
}) {
  try {
    console.log("🏁 피드백 세션 종료 요청:", { sessionId, endedBy });

    const sessionData = await redis.get(`feedback_session:${sessionId}`);
    if (!sessionData) {
      return {
        success: false,
        error: "세션을 찾을 수 없습니다.",
      };
    }

    const session: FeedbackSession =
      typeof sessionData === "string" ? JSON.parse(sessionData) : sessionData;

    // 이미 종료된 세션인지 확인
    if (session.status === "completed" || session.status === "ended") {
      console.log(
        `⚠️ 세션 ${sessionId}은 이미 ${session.status} 상태입니다.`
      );
      return {
        success: true,
        session,
        message: "세션이 이미 종료되었습니다.",
      };
    }

    // 세션 상태 업데이트
    session.status = "completed";
    session.endedAt = new Date().toISOString();
    session.endedBy = endedBy;

    await redis.set(
      `feedback_session:${sessionId}`,
      JSON.stringify(session),
      { ex: 3600 * 24 * 7 } // 7일간 보관
    );

    // 활성 세션 목록에서 제거
    await redis.srem(`team:${teamId}:active_feedback_sessions`, sessionId);

    // 실제 대화 메시지가 있는 경우에만 요약 생성
    const actualMessages = session.messages.filter(
      (msg) => msg.type === "message"
    );
    const shouldGenerateSummary = actualMessages.length >= 1; // 최소 1개 메시지

    if (shouldGenerateSummary) {
      // 피드백 세션 요약 생성 및 메모리 저장
      try {
        const { generateFeedbackSessionSummary } = await import(
          "@/lib/openai"
        );
        const { processMemoryUpdate } = await import("@/lib/memory");

        const summaryResult = await generateFeedbackSessionSummary(
          session.messages,
          session.participants
        );

        // 각 참가자의 메모리에 요약 저장 (AI 에이전트만)
        for (const participant of session.participants) {
          if (!participant.isUser && participant.id !== "Me") {
            try {
              await processMemoryUpdate({
                type: "FEEDBACK_SESSION_COMPLETED",
                payload: {
                  teamId,
                  sessionId,
                  session: session,
                  summary: summaryResult.summary,
                  keyPoints: summaryResult.keyInsights,
                },
              });

              console.log(
                `✅ 참가자 ${participant.name}의 메모리 업데이트 완료 (${endedBy} 종료)`
              );
            } catch (memoryError) {
              console.error(
                `❌ 참가자 ${participant.name}의 메모리 업데이트 실패:`,
                memoryError
              );
            }
          }
        }

        const sessionDuration = Math.floor(
          (new Date(session.endedAt!).getTime() -
            new Date(session.createdAt).getTime()) /
            (1000 * 60)
        );

        // 중복 체크를 위해 고유한 요약 ID 생성
        const summaryId = `${sessionId}_summary`;

        // 이미 해당 세션의 요약이 팀 채팅에 있는지 확인
        const existingSummaryCheck = await redis.get(
          `summary_check:${summaryId}`
        );
        if (existingSummaryCheck) {
          console.log(`⚠️ 세션 ${sessionId}의 요약이 이미 생성되었습니다.`);
        } else {
          const summaryMessage = {
            sender: "system" as const,
            type: "feedback_session_summary" as const,
            payload: {
              type: "feedback_session_summary" as const,
              sessionId: session.id,
              participants: session.participants.map((p) => p.name),
              targetIdea: session.targetIdea,
              summary: summaryResult.summary,
              keyInsights: summaryResult.keyInsights,
              messageCount: actualMessages.length,
              duration: Math.max(1, sessionDuration), // 최소 1분
              sessionMessages: session.messages, // 이미 객체 배열이므로 직접 사용
              endedBy: session.endedBy, // 종료 주체 정보 추가
            },
          };

          try {
            await addChatMessage(teamId, summaryMessage);
            console.log("✅ 피드백 세션 요약이 팀 채팅에 추가됨");

            // 요약 생성 완료 표시 (1시간 후 자동 삭제)
            await redis.set(`summary_check:${summaryId}`, "completed", {
              ex: 3600,
            });
          } catch (chatError) {
            console.error("❌ 피드백 세션 요약 채팅 추가 실패:", chatError);
          }
        }
      } catch (chatError) {
        console.error("❌ 피드백 세션 요약 처리 오류:", chatError);
      }
    } else {
      console.log(
        `⚠️ 세션 ${sessionId}에 충분한 메시지가 없어 요약을 생성하지 않습니다.`
      );
    }

    // 🔄 모든 참가자들의 상태를 idle로 되돌리기
    console.log(`🔄 ${session.participants.length}개 참가자 상태 정리 시작`);

    // 공통 에이전트 상태 초기화 함수
    const resetAgentStateWithRetry = async (participant: any) => {
      console.log(`🔧 에이전트 ${participant.name}(${participant.id}) 상태를 idle로 변경 시도`);

      try {
        await setAgentState(teamId, participant.id, {
          agentId: participant.id,
          currentState: "idle",
          lastStateChange: new Date().toISOString(),
          isProcessing: false,
          idleTimer: createNewIdleTimer(),
        });

        console.log(`✅ 에이전트 ${participant.name} 상태가 idle로 변경됨`);
        return true;
      } catch (error) {
        console.error(`❌ 에이전트 ${participant.name} idle 상태 변경 오류:`, error);
        return false;
      }
    };

    // 인간 사용자 상태 초기화 함수
    const resetUserState = async () => {
      console.log(`🔧 인간 사용자 피드백 세션 상태 제거 시도`);

      try {
        const userStateKey = `team:${teamId}:user_state`;
        const deleted = await redis.del(userStateKey);
        console.log(`✅ 인간 사용자 피드백 세션 상태 제거됨 (deleted: ${deleted})`);
        return true;
      } catch (error) {
        console.error(`❌ 인간 사용자 상태 초기화 오류:`, error);
        return false;
      }
    };

    // 참가자별 상태 초기화 실행
    const resetPromises = session.participants.map(participant => {
      if (!participant.isUser && participant.id !== "Me") {
        return resetAgentStateWithRetry(participant);
      } else if (participant.id === "Me") {
        return resetUserState();
      }
      return Promise.resolve(true);
    });

    await Promise.all(resetPromises);

    console.log(`✅ 피드백 세션 종료: ${sessionId}`);

    return {
      success: true,
      session,
    };
  } catch (error) {
    console.error("피드백 세션 직접 종료 실패:", error);
    return {
      success: false,
      error: "피드백 세션 종료에 실패했습니다.",
    };
  }
}