import { redis } from "@/lib/redis";
import { setAgentState, createNewIdleTimer } from "@/lib/agent-state-utils";

// 모든 에이전트 상태를 idle로 강제 초기화
export async function resetAllAgentStates(teamId: string) {
  try {
    console.log(`🔧 팀 ${teamId}의 모든 에이전트 상태 초기화 시작`);

    // 1. 모든 활성 피드백 세션 종료
    const activeSessionIds = await redis.smembers(`team:${teamId}:active_feedback_sessions`);

    if (activeSessionIds.length > 0) {
      console.log(`🧹 ${activeSessionIds.length}개 활성 피드백 세션 정리 중...`);

      for (const sessionId of activeSessionIds) {
        // 세션 상태를 completed로 변경
        const sessionData = await redis.get(`feedback_session:${sessionId}`);
        if (sessionData) {
          const session = typeof sessionData === "string" ? JSON.parse(sessionData) : sessionData;
          session.status = "completed";
          session.endedAt = new Date().toISOString();
          session.endedBy = "system_reset";

          await redis.set(`feedback_session:${sessionId}`, JSON.stringify(session), { ex: 3600 * 24 });
        }
      }

      // 활성 세션 목록 초기화
      await redis.del(`team:${teamId}:active_feedback_sessions`);
      console.log(`✅ 모든 피드백 세션 정리 완료`);
    }

    // 2. 사용자 상태 초기화 (여러 패턴으로 확실하게)
    const userStatePatterns = [
      `team:${teamId}:user_state`,
      `user_state:${teamId}:Me`,
      `user_state:${teamId}:user`,
      `agent_state:${teamId}:Me`,
      `agent_state:${teamId}:user`
    ];

    for (const pattern of userStatePatterns) {
      const deleted = await redis.del(pattern);
      if (deleted > 0) {
        console.log(`✅ 사용자 상태 키 삭제: ${pattern}`);
      }
    }

    // 패턴 매칭으로 추가 사용자 상태 키 찾아서 삭제
    const userStateKeys = await redis.keys(`*${teamId}*user*`);
    const meStateKeys = await redis.keys(`*${teamId}*Me*`);
    const allUserKeys = [...userStateKeys, ...meStateKeys];

    for (const key of allUserKeys) {
      const deleted = await redis.del(key);
      if (deleted > 0) {
        console.log(`✅ 추가 사용자 상태 키 삭제: ${key}`);
      }
    }

    console.log(`✅ 사용자 상태 완전 초기화 완료`);

    // 3. 모든 에이전트 상태를 idle로 초기화
    const agentStateKeys = await redis.keys(`agent_state:${teamId}:*`);

    let resetCount = 0;
    for (const stateKey of agentStateKeys) {
      const agentId = stateKey.split(':')[2]; // agent_state:teamId:agentId 형태에서 agentId 추출

      try {
        await setAgentState(teamId, agentId, {
          agentId,
          currentState: "idle",
          lastStateChange: new Date().toISOString(),
          isProcessing: false,
          idleTimer: createNewIdleTimer(),
        });

        resetCount++;
        console.log(`✅ 에이전트 ${agentId} 상태 idle로 초기화`);
      } catch (error) {
        console.error(`❌ 에이전트 ${agentId} 상태 초기화 실패:`, error);
      }
    }

    console.log(`🎉 팀 ${teamId} 상태 초기화 완료: ${resetCount}개 에이전트 처리됨`);

    return {
      success: true,
      sessionsCleared: activeSessionIds.length,
      agentsReset: resetCount,
    };
  } catch (error) {
    console.error(`❌ 팀 ${teamId} 상태 초기화 실패:`, error);
    return {
      success: false,
      error: error.message,
    };
  }
}

// 특정 에이전트만 초기화
export async function resetAgentState(teamId: string, agentId: string) {
  try {
    console.log(`🔧 에이전트 ${agentId} 상태 초기화 시작`);

    await setAgentState(teamId, agentId, {
      agentId,
      currentState: "idle",
      lastStateChange: new Date().toISOString(),
      isProcessing: false,
      idleTimer: createNewIdleTimer(),
    });

    console.log(`✅ 에이전트 ${agentId} 상태 idle로 초기화 완료`);

    return { success: true };
  } catch (error) {
    console.error(`❌ 에이전트 ${agentId} 상태 초기화 실패:`, error);
    return { success: false, error: error.message };
  }
}