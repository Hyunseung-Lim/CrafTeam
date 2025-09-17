import { Clock, Brain, MessageCircle, Pause, Zap } from "lucide-react";
import { AgentStateInfo } from "../hooks/useAgentStates";

interface AgentStateIndicatorProps {
  state: AgentStateInfo | undefined;
  timer: number | undefined;
  agentName: string;
}

// 향상된 상태 표시 컴포넌트
export default function AgentStateIndicator({
  state,
  timer,
  agentName,
}: AgentStateIndicatorProps) {
  // state가 undefined인 경우에만 조기 반환 (API 로딩 중)
  if (!state) {
    return (
      <div className="flex items-center gap-2 px-2 py-1 rounded-full bg-gray-100 text-gray-500 text-xs">
        <div className="w-2 h-2 bg-gray-400 rounded-full animate-pulse"></div>
        <span>Loading...</span>
      </div>
    );
  }

  const getStateInfo = () => {
    switch (state.currentState) {
      case "idle":
        return {
          icon: <Clock className="h-3 w-3" />,
          text: timer && timer > 0 ? `Wait (${timer}s)` : "Waiting",
          color: "bg-gray-100 text-gray-600",
          tooltip: state.idleTimer
            ? `Next action planned in ${Math.floor((timer || 0) / 60)}m ${
                (timer || 0) % 60
              }s`
            : "Waiting",
        };
      case "plan":
        return {
          icon: <Brain className="h-3 w-3" />,
          text: "Planning",
          color: "bg-yellow-100 text-yellow-700",
          tooltip:
            state.currentTask?.description || "Planning next action",
        };
      case "feedback_session":
        return {
          icon: <MessageCircle className="h-3 w-3" />,
          text: "In feedback session",
          color: "bg-orange-100 text-orange-700",
          tooltip: state.currentTask?.sessionInfo
            ? `Feedback session: ${state.currentTask.sessionInfo.participants.join(
                " & "
              )}`
            : state.currentTask?.description || "In feedback session",
        };
      case "feedback_waiting":
        return {
          icon: <Pause className="h-3 w-3" />,
          text: "Waiting for feedback",
          color: "bg-amber-100 text-amber-700",
          tooltip: state.currentTask?.requestInfo
            ? `Waiting for feedback from ${state.currentTask.requestInfo.requesterName}`
            : state.currentTask?.description || "Waiting for feedback",
        };
      case "reflecting":
        return {
          icon: <Brain className="h-3 w-3" />,
          text: "Reflecting",
          color: "bg-blue-100 text-blue-700",
          tooltip:
            state.currentTask?.description ||
            "Reflecting on experience and updating memory",
        };
      case "action":
        // 작업 타입에 따른 구체적인 표시
        const getActionText = () => {
          const taskType = state.currentTask?.type;
          const trigger = state.currentTask?.trigger;
          const requester = state.currentTask?.requestInfo?.requesterName;

          let baseText = "";
          switch (taskType) {
            case "generate_idea":
              baseText = "Generating idea";
              break;
            case "evaluate_idea":
              baseText = "Evaluating idea";
              break;
            case "planning":
              baseText = "Planning";
              break;
            case "thinking":
              baseText = "Thinking";
              break;
            case "give_feedback":
              baseText = "Preparing feedback session";
              break;
            case "make_request":
              baseText = "Creating request";
              break;
            case "reflecting":
              baseText = "Reflecting";
              break;
            case "feedback_session":
              baseText = "In feedback session";
              break;
            case "feedback_waiting":
              baseText = "Waiting for feedback";
              break;
            default:
              baseText = "Working";
          }

          // 트리거에 따라 추가 정보 표시
          if (trigger === "user_request" && requester) {
            return `${baseText}\n(Requested by ${requester})`;
          } else if (trigger === "ai_request" && requester) {
            return `${baseText}\n(Requested by ${requester})`;
          }

          return baseText;
        };

        const getActionColor = () => {
          const trigger = state.currentTask?.trigger;
          switch (trigger) {
            case "user_request":
              return "bg-purple-100 text-purple-700"; // 사용자 요청
            case "ai_request":
              return "bg-blue-100 text-blue-700"; // AI 요청
            default:
              return "bg-green-100 text-green-700"; // 자율적 작업
          }
        };

        const getActionTooltip = () => {
          const trigger = state.currentTask?.trigger;
          const requester = state.currentTask?.requestInfo?.requesterName;
          const message = state.currentTask?.requestInfo?.requestMessage;

          let tooltip =
            state.currentTask?.description || "Performing task";

          if (trigger === "user_request" && requester) {
            tooltip += `\nRequested by: ${requester}`;
            if (message) {
              tooltip += `\nRequest: ${message}`;
            }
          } else if (trigger === "ai_request" && requester) {
            tooltip += `\nRequested by: ${requester}`;
            if (message) {
              tooltip += `\nRequest: ${message}`;
            }
          } else if (trigger === "autonomous") {
            tooltip += "\n(Autonomous action)";
          }

          return tooltip;
        };

        return {
          icon: <Zap className="h-3 w-3" />,
          text: getActionText(),
          color: getActionColor(),
          tooltip: getActionTooltip(),
        };
      default:
        console.warn(`Unknown agent state detected:`, {
          agentName,
          currentState: state.currentState,
          isProcessing: state.isProcessing,
          currentTask: state.currentTask,
          lastStateChange: state.lastStateChange,
        });
        return {
          icon: <Clock className="h-3 w-3" />,
          text: "Unknown",
          color: "bg-gray-100 text-gray-600",
          tooltip: `Cannot determine state (${state.currentState})`,
        };
    }
  };

  const stateInfo = getStateInfo();

  return (
    <div className="relative group">
      <span
        className={`text-xs px-2 py-1 rounded-full flex items-center gap-1 ${stateInfo.color} flex-shrink-0 cursor-help whitespace-pre-line`}
      >
        {stateInfo.icon}
        {stateInfo.text}
      </span>

      {/* 툴팁 */}
      <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-50 w-52">
        <div className="font-medium">{agentName}</div>
        <div className="whitespace-pre-line">{stateInfo.tooltip}</div>
        {state.currentState === "idle" &&
          state.idleTimer &&
          timer &&
          timer > 0 && (
            <div className="text-gray-300 mt-1">
              Expected completion: {Math.ceil(timer)}s
            </div>
          )}
        {state.currentState === "action" &&
          state.currentTask?.trigger &&
          state.currentTask.trigger !== "autonomous" && (
            <div className="text-gray-300 mt-1">
              {state.currentTask.trigger === "user_request"
                ? "👤 User request"
                : "🤖 AI request"}
            </div>
          )}
        {/* 툴팁 화살표 */}
        <div className="absolute top-full left-1/2 transform -translate-x-1/2 border-4 border-transparent border-t-gray-900"></div>
      </div>
    </div>
  );
}
