// 클라이언트에서 에이전트 상태 초기화를 위한 유틸리티 함수들

export async function resetAllAgents(teamId: string) {
  try {
    const response = await fetch(`/api/teams/${teamId}/reset-agents`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "reset_all",
      }),
    });

    const result = await response.json();

    if (response.ok) {
      console.log("✅ 모든 에이전트 상태 초기화 성공:", result.message);

      // 강제 새로고침으로 최신 상태 즉시 반영
      try {
        await forceRefreshAgentStates(teamId);
        alert(`✅ 초기화 완료!\n${result.message}`);
      } catch (stateError) {
        console.error("❌ 상태 새로고침 실패:", stateError);
        alert(`✅ 초기화 완료!\n${result.message}\n(새로고침으로 최신 상태를 확인하세요)`);
      }

      return result;
    } else {
      console.error("❌ 에이전트 상태 초기화 실패:", result.error);
      alert(`❌ 초기화 실패:\n${result.error}`);
      throw new Error(result.error);
    }
  } catch (error) {
    console.error("❌ 초기화 요청 오류:", error);
    alert(`❌ 요청 오류: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

export async function resetSingleAgent(teamId: string, agentId: string) {
  try {
    const response = await fetch(`/api/teams/${teamId}/reset-agents`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "reset_agent",
        agentId: agentId,
      }),
    });

    const result = await response.json();

    if (response.ok) {
      console.log(`✅ 에이전트 ${agentId} 상태 초기화 성공:`, result.message);

      // 강제 새로고침으로 최신 상태 즉시 반영
      try {
        await forceRefreshAgentStates(teamId);
        alert(`✅ 초기화 완료!\n${result.message}`);
      } catch (stateError) {
        console.error("❌ 상태 새로고침 실패:", stateError);
        alert(`✅ 초기화 완료!\n${result.message}\n(새로고침으로 최신 상태를 확인하세요)`);
      }

      return result;
    } else {
      console.error(`❌ 에이전트 ${agentId} 상태 초기화 실패:`, result.error);
      alert(`❌ 초기화 실패:\n${result.error}`);
      throw new Error(result.error);
    }
  } catch (error) {
    console.error(`❌ 에이전트 ${agentId} 초기화 요청 오류:`, error);
    alert(`❌ 요청 오류: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

// 브라우저 콘솔에서 바로 사용할 수 있도록 전역 함수로 노출
declare global {
  interface Window {
    resetAllAgents: (teamId: string) => Promise<any>;
    resetSingleAgent: (teamId: string, agentId: string) => Promise<any>;
    forceRefreshAgentStates: (teamId: string) => Promise<any>;
    forceEndAllFeedbackSessions: (teamId: string) => Promise<any>;
    nuclearReset: (teamId: string) => Promise<any>;
  }
}

// 전역 강제 새로고침 함수
export async function forceRefreshAgentStates(teamId: string) {
  try {
    console.log("🔄 에이전트 상태 강제 새로고침 시작...");
    const response = await fetch(`/api/teams/${teamId}/agent-states`);

    if (response.ok) {
      const data = await response.json();
      console.log("✅ 최신 에이전트 상태:", data);

      // 각 에이전트의 피드백 세션 상태 상세 로그
      data.agentStates.forEach((agent: any) => {
        const state = agent.state;
        console.log(`🔍 ${agent.name} 상태:`, {
          currentState: state.currentState,
          isProcessing: state.isProcessing,
          taskType: state.currentTask?.type,
          sessionInfo: state.currentTask?.sessionInfo,
          isFeedbackSession: agent.isFeedbackSession
        });
      });

      // 브라우저 이벤트를 발생시켜 React 컴포넌트에 알림
      const event = new CustomEvent('forceAgentStateRefresh', {
        detail: { teamId, data }
      });
      window.dispatchEvent(event);

      return data;
    } else {
      console.error("❌ 상태 새로고침 실패:", response.statusText);
      throw new Error(response.statusText);
    }
  } catch (error) {
    console.error("❌ 강제 새로고침 오류:", error);
    throw error;
  }
}

// 피드백 세션 강제 종료 함수 추가
export async function forceEndAllFeedbackSessions(teamId: string) {
  try {
    console.log("🛑 모든 피드백 세션 강제 종료 시작...");

    // 활성 피드백 세션 조회
    const statesResponse = await fetch(`/api/teams/${teamId}/agent-states`);
    const statesData = await statesResponse.json();

    console.log("🔍 활성 피드백 세션:", statesData.activeFeedbackSessions);

    // 각 세션을 개별적으로 종료
    for (const session of statesData.activeFeedbackSessions || []) {
      try {
        console.log(`🛑 세션 ${session.sessionId} 종료 중...`);

        const endResponse = await fetch(`/api/teams/${teamId}/feedback-sessions/${session.sessionId}/end`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: "force_end_by_admin" })
        });

        if (endResponse.ok) {
          console.log(`✅ 세션 ${session.sessionId} 종료 완료`);
        } else {
          console.error(`❌ 세션 ${session.sessionId} 종료 실패`);
        }
      } catch (sessionError) {
        console.error(`❌ 세션 ${session.sessionId} 종료 오류:`, sessionError);
      }
    }

    // 모든 에이전트 상태 재설정
    await resetAllAgents(teamId);

    console.log("✅ 모든 피드백 세션 강제 종료 완료");

  } catch (error) {
    console.error("❌ 피드백 세션 강제 종료 오류:", error);
    throw error;
  }
}

// 최종 수단: 완전 정리 함수
export async function nuclearReset(teamId: string) {
  try {
    console.log("☢️ NUCLEAR RESET 시작 - 모든 상태 완전 초기화");

    // 1. 모든 피드백 세션 강제 종료
    await forceEndAllFeedbackSessions(teamId);

    // 2. 잠시 대기 (서버 처리 시간 확보)
    await new Promise(resolve => setTimeout(resolve, 2000));

    // 3. 모든 에이전트 상태 재설정
    await resetAllAgents(teamId);

    // 4. 잠시 대기
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 5. 최종 상태 확인 및 강제 새로고침
    await forceRefreshAgentStates(teamId);

    // 6. 페이지 완전 새로고침
    console.log("☢️ NUCLEAR RESET 완료 - 페이지 새로고침");
    window.location.reload();

  } catch (error) {
    console.error("☢️ NUCLEAR RESET 실패:", error);
    alert("Nuclear reset 실패. 수동으로 페이지를 새로고침하세요.");
    throw error;
  }
}

// 브라우저 환경에서만 전역 함수 등록
if (typeof window !== "undefined") {
  window.resetAllAgents = resetAllAgents;
  window.resetSingleAgent = resetSingleAgent;
  window.forceRefreshAgentStates = forceRefreshAgentStates;
  window.forceEndAllFeedbackSessions = forceEndAllFeedbackSessions;
  window.nuclearReset = nuclearReset;
}