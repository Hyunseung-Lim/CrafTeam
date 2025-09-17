import { NextRequest, NextResponse } from "next/server";
import { getTeamById, getAgentById, redis } from "@/lib/redis";
import {
  AgentStateInfo,
  getAgentState,
  setAgentState,
  isFeedbackSessionActive,
  createNewIdleTimer,
} from "@/lib/agent-state-utils";
import { updateAgentStateTimer } from "@/lib/agent-state-manager";
import {
  processRequestInBackground,
  processQueuedRequest,
} from "@/lib/agent-background-processor";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ teamId: string }> }
) {
  try {
    const { teamId } = await params;

    // 팀 정보 가져오기
    const team = await getTeamById(teamId);
    if (!team) {
      return NextResponse.json(
        { error: "팀을 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    // 모든 에이전트 상태를 병렬로 조회 및 처리
    const agentStatePromises = team.members
      .filter((member) => !member.isUser && member.agentId)
      .map(async (member) => {
        try {
          let state = await getAgentState(teamId, member.agentId!);

          // 상태가 있으면 타이머 업데이트 실행
          if (state) {
            const updatedState = await updateAgentStateTimer(teamId, state);
            // 업데이트된 상태를 Redis에 저장
            await setAgentState(teamId, member.agentId!, updatedState);
            state = updatedState;
          }

          // state가 여전히 null인 경우 기본 상태 생성 (getAgentState에서 실패한 경우)
          if (!state) {
            console.log(
              `⚠️ ${member.agentId} 상태가 null이므로 기본 상태 생성`
            );
            state = {
              agentId: member.agentId!,
              currentState: "idle",
              lastStateChange: new Date().toISOString(),
              isProcessing: false,
              idleTimer: createNewIdleTimer(),
            };
            // Redis에 저장
            try {
              await setAgentState(teamId, member.agentId!, state);
            } catch (saveError) {
              console.error(
                `❌ ${member.agentId} 기본 상태 저장 실패:`,
                saveError
              );
            }
          }

          const agent = await getAgentById(member.agentId!);
          return {
            agentId: member.agentId!,
            name: agent?.name || member.agentId!,
            state: state, // 이제 항상 유효한 상태 객체
            isFeedbackSession: isFeedbackSessionActive(state),
          };
        } catch (error) {
          console.error(`❌ 에이전트 ${member.agentId} 상태 조회 실패:`, error);

          // 에러 발생 시에도 기본 상태 생성
          const defaultState = {
            agentId: member.agentId!,
            currentState: "idle" as const,
            lastStateChange: new Date().toISOString(),
            isProcessing: false,
            idleTimer: createNewIdleTimer(),
          };

          // 기본 상태를 Redis에 저장 시도
          try {
            await setAgentState(teamId, member.agentId!, defaultState);
          } catch (saveError) {
            console.error(
              `❌ ${member.agentId} 에러 후 기본 상태 저장 실패:`,
              saveError
            );
          }

          return {
            agentId: member.agentId!,
            name: member.agentId!,
            state: defaultState, // null 대신 기본 상태 반환
            isFeedbackSession: false,
          };
        }
      });

    // 활성 피드백 세션 조회와 사용자 상태 조회도 병렬로 처리
    const [agentStates, activeSessionIds, userStateData] = await Promise.all([
      Promise.all(agentStatePromises),
      redis.smembers(`team:${teamId}:active_feedback_sessions`),
      redis.get(`team:${teamId}:user_state`),
    ]);

    // 활성 피드백 세션 정보 처리 - 존재하는 세션만 조회
    const sessionInfoPromises = activeSessionIds.map(async (sessionId) => {
      try {
        const sessionData = await redis.get(`feedback_session:${sessionId}`);
        if (sessionData) {
          const session =
            typeof sessionData === "string"
              ? JSON.parse(sessionData)
              : sessionData;

          // 세션이 실제로 활성 상태인지 확인
          if (session.status === "active") {
            return {
              sessionId: session.id,
              status: session.status,
              participants: session.participants.map((p: any) => ({
                id: p.id,
                name: p.name,
                isUser: p.isUser,
              })),
              createdAt: session.createdAt,
              endedAt: session.endedAt,
            };
          } else {
            // 비활성 세션은 set에서 제거
            redis.srem(`team:${teamId}:active_feedback_sessions`, sessionId);
            return null;
          }
        } else {
          // 존재하지 않는 세션은 set에서 제거
          redis.srem(`team:${teamId}:active_feedback_sessions`, sessionId);
          return null;
        }
      } catch (error) {
        console.error(`❌ 세션 ${sessionId} 조회 실패:`, error);
        return null;
      }
    });

    const sessionInfo = (await Promise.all(sessionInfoPromises)).filter(
      Boolean
    );

    // 인간 사용자 상태 처리
    const userState = userStateData
      ? typeof userStateData === "string"
        ? JSON.parse(userStateData)
        : userStateData
      : null;

    return NextResponse.json({
      teamId,
      agentStates,
      activeFeedbackSessions: sessionInfo,
      userState,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("에이전트 상태 조회 실패:", error);
    return NextResponse.json(
      { error: "상태 조회에 실패했습니다." },
      { status: 500 }
    );
  }
}

// 에이전트 상태 업데이트를 위한 POST 메서드
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ teamId: string }> }
) {
  try {
    const { teamId } = await params;
    const body = await request.json();
    const {
      agentId,
      currentState,
      taskType,
      taskDescription,
      estimatedDuration,
      trigger = "autonomous",
      plannedAction,
      sessionInfo,
      forceClear = false, // 강제 초기화 플래그 추가
      action, // 새로운 필드: 요청 처리용
      requestData, // 새로운 필드: 요청 데이터
      requestInfo, // 요청 정보 필드 추가
    } = body;

    console.log(`📋 에이전트 ${agentId} 상태 변경 요청`);

    // "Me" 사용자 요청은 스킵 (사용자는 에이전트가 아님)
    if (agentId === "Me") {
      return NextResponse.json({
        success: true,
        message: "User state change skipped - not an agent",
      });
    }

    // reset_all_agents 액션 처리
    if (action === "reset_all_agents") {
      console.log(`🔄 모든 에이전트 상태 초기화 요청`);

      try {
        // 팀 정보 가져오기
        const team = await getTeamById(teamId);
        if (!team) {
          return NextResponse.json(
            { error: "팀을 찾을 수 없습니다." },
            { status: 404 }
          );
        }

        // AI 에이전트 목록 가져오기
        const aiAgents = team.members.filter(
          (member) => !member.isUser && member.agentId
        );

        const results = [];

        // 각 에이전트 상태 초기화
        for (const member of aiAgents) {
          try {
            const forcedState: AgentStateInfo = {
              agentId: member.agentId!,
              currentState: "idle",
              lastStateChange: new Date().toISOString(),
              isProcessing: false,
              idleTimer: createNewIdleTimer(),
            };

            await setAgentState(teamId, member.agentId!, forcedState);

            results.push({
              agentId: member.agentId!,
              status: "success",
              message: "초기화 완료",
            });

            console.log(`✅ 에이전트 ${member.agentId} 상태 초기화 완료`);
          } catch (agentError) {
            console.error(
              `❌ 에이전트 ${member.agentId} 초기화 실패:`,
              agentError
            );
            results.push({
              agentId: member.agentId!,
              status: "error",
              message: `초기화 실패: ${
                agentError instanceof Error
                  ? agentError.message
                  : String(agentError)
              }`,
            });
          }
        }

        console.log(`✅ 모든 에이전트 상태 초기화 완료`);

        return NextResponse.json({
          success: true,
          message: "모든 에이전트 상태가 초기화되었습니다.",
          results,
        });
      } catch (error) {
        console.error("❌ 모든 에이전트 상태 초기화 실패:", error);
        return NextResponse.json(
          { error: "상태 초기화에 실패했습니다." },
          { status: 500 }
        );
      }
    }

    // forceClear가 true이면 모든 체크를 무시하고 강제로 상태 변경
    if (forceClear && currentState === "idle") {
      console.log(`🔧 에이전트 ${agentId} 강제 idle 상태 초기화 - 큐 확인 포함`);

      // 강제 초기화이지만 큐는 여전히 확인해야 함
      const hasQueuedRequest = await processQueuedRequest(teamId, agentId);
      
      if (!hasQueuedRequest) {
        // 큐에 요청이 없으면 idle 상태로 설정
        const idleState = {
          agentId,
          currentState: "idle" as const,
          lastStateChange: new Date().toISOString(),
          isProcessing: false,
          idleTimer: createNewIdleTimer(),
        };
        await setAgentState(teamId, agentId, idleState);
      }

      console.log(`✅ 에이전트 ${agentId} 강제 idle 상태 초기화 완료 (큐 처리: ${hasQueuedRequest ? "있음" : "없음"})`);

      return NextResponse.json({
        success: true,
        message: "에이전트 상태가 강제로 idle로 초기화되었습니다",
        queueProcessed: hasQueuedRequest,
      });
    }

    // 다른 액션들은 agentId가 필요함
    if (!agentId) {
      return NextResponse.json(
        { error: "agentId가 필요합니다." },
        { status: 400 }
      );
    }

    // 요청 처리 액션인 경우
    if (action === "process_request" && requestData) {
      console.log(`📨 에이전트 ${agentId}에게 요청 처리: ${requestData.type}`);
      console.log(`요청 상세 정보:`, JSON.stringify(requestData, null, 2));

      // 현재 에이전트 상태 확인
      const currentAgentState = await getAgentState(teamId, agentId);
      console.log(
        `현재 에이전트 상태:`,
        JSON.stringify(currentAgentState, null, 2)
      );

      // 에이전트 상태가 없는 경우
      if (!currentAgentState) {
        console.error(`❌ 에이전트 ${agentId} 상태를 찾을 수 없습니다.`);
        return NextResponse.json(
          { error: "에이전트 상태를 찾을 수 없습니다." },
          { status: 404 }
        );
      }

      // 피드백 세션 중인지 확인
      if (isFeedbackSessionActive(currentAgentState)) {
        console.log(
          `⚠️ 에이전트 ${agentId}가 피드백 세션 중이므로 요청 처리 불가`
        );
        return NextResponse.json(
          {
            error: "에이전트가 현재 피드백 세션에 참여 중입니다.",
            agentState: currentAgentState,
          },
          { status: 409 }
        );
      }

      // 에이전트가 바쁜지 확인하고 적절히 처리
      if (currentAgentState.isProcessing || currentAgentState.currentState !== "idle") {
        console.log(`⏳ 에이전트 ${agentId}가 바쁘므로 행동을 큐에 추가`);
        
        // 요청 타입에 따른 행동을 큐에 추가 (기존 queueRetrospective 패턴 사용)
        const actionRequest = {
          id: `action-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          type: requestData.type, // generate_idea, evaluate_idea, give_feedback
          requesterName: requestData.requesterName,
          payload: requestData.payload,
          timestamp: new Date().toISOString(),
          teamId: teamId,
        };
        
        const queueKey = `agent_queue:${teamId}:${agentId}`;
        await redis.lpush(queueKey, JSON.stringify(actionRequest));
        
        console.log(`✅ ${requestData.type} 행동이 Redis 큐에 추가됨 (key: ${queueKey})`);
        
        return NextResponse.json({
          message: "에이전트가 바쁘므로 행동이 큐에 추가되었습니다.",
          agentId,
          requestType: requestData.type,
          queued: true,
        });
      } else {
        console.log(`🔄 에이전트 ${agentId}가 여유로우므로 즉시 처리`);
        
        // 백그라운드에서 요청 처리
        processRequestInBackground(teamId, agentId, requestData);

        return NextResponse.json({
          message: "요청이 즉시 처리 중입니다.",
          agentId,
          requestType: requestData.type,
          queued: false,
        });
      }
    }

    const now = new Date();
    let newState: AgentStateInfo;

    if (currentState === "idle") {
      // idle 상태로 전환 시 큐 확인 및 처리
      const hasQueuedRequest = await processQueuedRequest(teamId, agentId);
      
      if (!hasQueuedRequest) {
        // 큐에 요청이 없으면 idle 상태 생성
        newState = {
          agentId,
          currentState: "idle",
          lastStateChange: now.toISOString(),
          isProcessing: false,
          idleTimer: createNewIdleTimer(),
        };
      } else {
        // 큐에 요청이 있었으면 현재 상태를 다시 조회
        const currentAgentState = await getAgentState(teamId, agentId);
        newState = currentAgentState || {
          agentId,
          currentState: "idle",
          lastStateChange: now.toISOString(),
          isProcessing: false,
          idleTimer: createNewIdleTimer(),
        };
      }
    } else if (currentState === "plan" || currentState === "action") {
      // 작업 상태로 전환
      newState = {
        agentId,
        currentState,
        lastStateChange: now.toISOString(),
        isProcessing: true,
        currentTask: {
          type: taskType || "thinking",
          description: taskDescription || "작업을 수행하고 있습니다",
          startTime: now.toISOString(),
          estimatedDuration: estimatedDuration || 60,
          trigger: trigger || "autonomous",
          requestInfo: requestInfo,
        },
      };

      if (plannedAction) {
        newState.plannedAction = plannedAction;
      }
    } else if (currentState === "feedback_session") {
      // 피드백 세션 상태로 전환
      newState = {
        agentId,
        currentState: "feedback_session",
        lastStateChange: now.toISOString(),
        isProcessing: true,
        currentTask: {
          type: "feedback_session",
          description: taskDescription || "피드백 세션 진행 중",
          startTime: now.toISOString(),
          estimatedDuration: estimatedDuration || 300, // 5분 기본값
          trigger: trigger || "user_request",
          requestInfo: requestInfo,
          sessionInfo: sessionInfo,
        },
      };
    } else if (currentState === "reflecting") {
      // 회고 상태로 전환
      newState = {
        agentId,
        currentState: "reflecting",
        lastStateChange: now.toISOString(),
        isProcessing: true,
        currentTask: {
          type: "reflecting",
          description: taskDescription || "경험을 바탕으로 자기 성찰 중",
          startTime: now.toISOString(),
          estimatedDuration: estimatedDuration || 10,
          trigger: "autonomous",
          requestInfo: requestInfo,
        },
      };
    } else {
      return NextResponse.json(
        { error: "유효하지 않은 상태입니다." },
        { status: 400 }
      );
    }

    // Redis에 상태 저장
    await setAgentState(teamId, agentId, newState);

    return NextResponse.json({
      success: true,
      message: "에이전트 상태가 업데이트되었습니다.",
      state: newState,
    });
  } catch (error) {
    console.error("에이전트 상태 업데이트 실패:", error);
    return NextResponse.json(
      { error: "상태 업데이트에 실패했습니다." },
      { status: 500 }
    );
  }
}
