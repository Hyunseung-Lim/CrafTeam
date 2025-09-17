"use client";

import { useState, useEffect } from "react";
import { Idea, AIAgent, Team, Evaluation } from "@/lib/types";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { canEvaluateIdea } from "@/lib/relationship-utils";

interface IdeaDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  idea: Idea | null;
  ideas: Idea[];
  currentIndex: number;
  onIndexChange: (index: number) => void;
  team: Team | null;
  agents: AIAgent[];
  onSubmitEvaluation?: (evaluationData: {
    novelty: number;
    completeness: number;
    quality: number;
    comment: string;
  }) => Promise<{ success: boolean } | undefined>;
  isSubmittingEvaluation?: boolean;
  onIdeaUpdate?: () => Promise<void>;
}

export default function IdeaDetailModal({
  isOpen,
  onClose,
  idea,
  ideas,
  currentIndex,
  onIndexChange,
  team,
  agents,
  onSubmitEvaluation,
  isSubmittingEvaluation = false,
  onIdeaUpdate,
}: IdeaDetailModalProps) {
  const [isEditMode, setIsEditMode] = useState(false);
  const [showEvaluationForm, setShowEvaluationForm] = useState(false);
  const [evaluationSubmitted, setEvaluationSubmitted] = useState(false);
  const [editFormData, setEditFormData] = useState({
    object: "",
    function: "",
    behavior: "",
    structure: "",
  });
  const [behaviorPairs, setBehaviorPairs] = useState<
    Array<{ key: string; value: string }>
  >([]);
  const [structurePairs, setStructurePairs] = useState<
    Array<{ key: string; value: string }>
  >([]);
  const [evaluationFormData, setEvaluationFormData] = useState({
    novelty: 0,
    completeness: 0,
    quality: 0,
    comment: "",
  });

  // textarea 자동 높이 조절 함수
  const adjustTextareaHeight = (textarea: HTMLTextAreaElement) => {
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  };

  // textarea ref를 사용하여 높이 자동 조절
  const handleTextareaChange = (
    e: React.ChangeEvent<HTMLTextAreaElement>,
    callback: (value: string) => void
  ) => {
    adjustTextareaHeight(e.target);
    callback(e.target.value);
  };

  // JSON 문자열을 키-값 쌍 배열로 변환
  const parseJsonToPairs = (
    data: any
  ): Array<{ key: string; value: string }> => {
    // 이미 배열인 경우 (파싱된 상태)
    if (Array.isArray(data)) {
      const validPairs = data.filter(item => 
        item && typeof item === 'object' && 'key' in item && 'value' in item
      );
      return validPairs.length > 0 ? validPairs : [{ key: "", value: "" }];
    }
    
    // 이미 객체인 경우 (파싱된 상태)
    if (data && typeof data === "object" && data !== null) {
      return Object.entries(data).map(([key, value]) => ({
        key: String(key),
        value: String(value),
      }));
    }
    
    // 문자열 처리
    if (!data || typeof data !== 'string' || data.trim() === "") {
      return [{ key: "", value: "" }];
    }
    
    // 이중 이스케이프된 문자열 처리
    let processedString = data;
    if (data.includes('\\\\"')) {
      try {
        processedString = JSON.parse(data);
      } catch (e) {
        // 이중 파싱 실패 시 원본 사용
      }
    }
    
    try {
      const parsed = JSON.parse(processedString);
      if (Array.isArray(parsed)) {
        const validPairs = parsed.filter(item => 
          item && typeof item === 'object' && 'key' in item && 'value' in item
        );
        return validPairs.length > 0 ? validPairs : [{ key: "", value: "" }];
      } else if (typeof parsed === "object" && parsed !== null) {
        return Object.entries(parsed).map(([key, value]) => ({
          key: String(key),
          value: String(value),
        }));
      }
    } catch (error) {
      // JSON 파싱 실패 시 원본 텍스트를 단일 쌍으로 처리
    }
    return [{ key: "", value: data }];
  };

  // 키-값 쌍 배열을 JSON 문자열로 변환
  const pairsToJsonString = (
    pairs: Array<{ key: string; value: string }>
  ): string => {
    const validPairs = pairs.filter(
      (pair) => pair.key.trim() && pair.value.trim()
    );
    if (validPairs.length === 0) return "";

    // AddIdeaModal과 동일한 형태로 배열로 저장
    return JSON.stringify(validPairs);
  };

  // 안전한 데이터 렌더링 함수
  const renderSafeData = (data: any): React.ReactElement => {
    // 빈 데이터 처리
    if (!data || data === "" || data === "[]" || data === "{}") {
      return (
        <div className="text-gray-400 italic text-sm">
          No information entered.
        </div>
      );
    }
    
    // 값을 안전하게 표시하는 헬퍼 함수
    const renderValue = (value: any): string => {
      if (typeof value === 'object' && value !== null) {
        try {
          return JSON.stringify(value, null, 2);
        } catch {
          return '[object Object]';
        }
      }
      return String(value);
    };
    
    if (typeof data === "string") {
      try {
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed)) {
          // 배열인 경우 - key-value 쌍으로 처리
          if (parsed.length === 0) {
            return (
              <div className="text-gray-400 italic text-sm">
                No information entered.
              </div>
            );
          }
          return (
            <div className="space-y-4">
              {parsed.map((item, index) => (
                <div key={index} className="border-l-4 border-blue-200 pl-4">
                  <div className="font-medium text-gray-800 mb-1">{item.key || `Element ${index + 1}`}</div>
                  <div className="text-gray-600 text-sm whitespace-pre-wrap">{renderValue(item.value || item)}</div>
                </div>
              ))}
            </div>
          );
        } else if (typeof parsed === "object" && parsed !== null) {
          // 객체인 경우
          return (
            <div className="space-y-4">
              {Object.entries(parsed).map(([key, value]) => (
                <div key={key} className="border-l-4 border-blue-200 pl-4">
                  <div className="font-medium text-gray-800 mb-1">{key}</div>
                  <div className="text-gray-600 text-sm whitespace-pre-wrap">{renderValue(value)}</div>
                </div>
              ))}
            </div>
          );
        }
        return <p className="text-gray-600">{data}</p>;
      } catch (parseError) {
        // JSON 파싱 실패 시 raw JSON 표시
        return (
          <div className="space-y-2">
            <div className="text-yellow-600 text-sm font-medium">
              ⚠️ JSON Parsing Failed - Raw Data:
            </div>
            <pre className="bg-gray-100 p-3 rounded text-sm text-gray-700 whitespace-pre-wrap overflow-x-auto">
              {data}
            </pre>
          </div>
        );
      }
    } else if (typeof data === "object" && data !== null) {
      // 이미 객체인 경우
      if (Array.isArray(data)) {
        if (data.length === 0) {
          return (
            <div className="text-gray-400 italic text-sm">
              No information entered.
            </div>
          );
        }
        return (
          <div className="space-y-4">
            {data.map((item, index) => (
              <div key={index} className="border-l-4 border-blue-200 pl-4">
                <div className="font-medium text-gray-800 mb-1">{item.key || `Element ${index + 1}`}</div>
                <div className="text-gray-600 text-sm whitespace-pre-wrap">{renderValue(item.value || item)}</div>
              </div>
            ))}
          </div>
        );
      } else {
        return (
          <div className="space-y-4">
            {Object.entries(data).map(([key, value]) => (
              <div key={key} className="border-l-4 border-blue-200 pl-4">
                <div className="font-medium text-gray-800 mb-1">{key}</div>
                <div className="text-gray-600 text-sm whitespace-pre-wrap">{renderValue(value)}</div>
              </div>
            ))}
          </div>
        );
      }
    } else {
      // 다른 타입인 경우 문자열로 변환
      return <p className="text-gray-600">{renderValue(data)}</p>;
    }
  };

  // 작성자 이름 가져오기 함수
  const getAuthorName = (authorId: string) => {
    if (authorId === "나") return "나";

    const member = team?.members.find((m) => m.agentId === authorId);
    if (member && !member.isUser) {
      const agent = agents.find((a) => a.id === authorId);
      return agent?.name || `Agent ${authorId}`;
    }

    return authorId;
  };

  const getEvaluatorName = (evaluatorId: string) => {
    if (evaluatorId === "나") return "나";

    const member = team?.members.find((m) => m.agentId === evaluatorId);
    if (member && !member.isUser) {
      const agent = agents.find((a) => a.id === evaluatorId);
      return agent?.name || `Agent ${evaluatorId}`;
    }

    return evaluatorId;
  };

  // 아이디어 번호 매기기를 위한 생성순 정렬
  const ideasSortedByCreation = [...ideas].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const handlePrevious = () => {
    const newIndex = currentIndex > 0 ? currentIndex - 1 : ideas.length - 1;
    onIndexChange(newIndex);
  };

  const handleNext = () => {
    const newIndex = currentIndex < ideas.length - 1 ? currentIndex + 1 : 0;
    onIndexChange(newIndex);
  };

  const handleEditModeToggle = () => {
    if (!idea) return;

    setIsEditMode(true);
    // 편집 모드 진입 시 현재 데이터로 폼 초기화
    setEditFormData({
      object: idea.content.object,
      function: idea.content.function,
      behavior: idea.content.behavior,
      structure: idea.content.structure,
    });
    // behavior와 structure를 키-값 쌍으로 파싱
    setBehaviorPairs(parseJsonToPairs(idea.content.behavior));
    setStructurePairs(parseJsonToPairs(idea.content.structure));
  };

  const handleSave = async () => {
    if (!idea || !team) return;

    try {
      const updatedContent = {
        object: editFormData.object,
        function: editFormData.function,
        behavior: pairsToJsonString(behaviorPairs),
        structure: pairsToJsonString(structurePairs),
      };

      console.log("아이디어 업데이트:", updatedContent);

      const response = await fetch(`/api/teams/${team.id}/ideas/${idea.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: updatedContent,
        }),
      });

      if (response.ok) {
        const result = await response.json();
        
        // 업데이트 성공 시 편집 모드 종료
        setIsEditMode(false);
        
        // 부모 컴포넌트에서 아이디어 목록 새로고침
        if (onIdeaUpdate) {
          await onIdeaUpdate();
        }
        
        // API에서 받은 메시지 표시
        alert(result.message || "Idea update successful");
        console.log("Idea update successful");
      } else {
        console.error("Idea update failed:", response.status);
        alert("Failed to update idea.");
      }
    } catch (error) {
      console.error("Idea update error:", error);
      alert("An error occurred while updating the idea.");
    }
  };

  const handleCancel = () => {
    if (!idea) return;

    setIsEditMode(false);
    // 편집 취소 시 원래 데이터로 복원
    setEditFormData({
      object: idea.content.object,
      function: idea.content.function,
      behavior: idea.content.behavior,
      structure: idea.content.structure,
    });
    setBehaviorPairs(parseJsonToPairs(idea.content.behavior));
    setStructurePairs(parseJsonToPairs(idea.content.structure));
  };

  const handleEvaluationSubmit = async () => {
    if (!onSubmitEvaluation || !idea) return;

    if (
      !evaluationFormData.novelty ||
      !evaluationFormData.completeness ||
      !evaluationFormData.quality ||
      !evaluationFormData.comment.trim()
    ) {
      alert("Please complete all evaluation items.");
      return;
    }

    try {
      const result = await onSubmitEvaluation(evaluationFormData);
      
      // 성공 시에만 폼 초기화 및 숨기기
      if (result && result.success !== false) {
        setEvaluationFormData({
          novelty: 0,
          completeness: 0,
          quality: 0,
          comment: "",
        });
        setShowEvaluationForm(false);

        // 성공 메시지 표시
        alert("Evaluation submitted successfully!");
      } else {
        throw new Error("Failed to submit evaluation.");
      }
    } catch (error) {
      console.error("평가 제출 실패:", error);
      alert("Failed to submit evaluation. Please try again.");
    }
  };

  if (!isOpen || !idea) return null;

  // 사용자 역할 확인
  const userMember = team?.members.find((member) => member.isUser);
  const userRoles = userMember?.roles || [];
  const canUpdateIdeas = userRoles.includes("Idea Generation");
  const hasEvaluationRole = userRoles.includes("Idea Evaluation");
  const hasEvaluationRelationship = team && idea ? canEvaluateIdea("나", idea.author, team) : false;
  const canEvaluateIdeas = hasEvaluationRole && hasEvaluationRelationship;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* 배경 오버레이 */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
        onClick={onClose}
      />

      {/* 모달 컨테이너 */}
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl h-[90vh] flex flex-col overflow-hidden relative">
          {/* 상단 네비게이션 */}
          <div className="flex items-center justify-between p-6 border-b border-gray-200 bg-white z-10">
            <div className="flex items-center gap-4">
              <button
                onClick={handlePrevious}
                className="p-2 hover:bg-gray-100 rounded-full transition-colors"
              >
                <svg
                  className="w-5 h-5 text-gray-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 19l-7-7 7-7"
                  />
                </svg>
              </button>
              <h2 className="text-xl font-bold text-gray-900">
                Idea #
                {ideasSortedByCreation.findIndex((i) => i.id === idea.id) + 1}
              </h2>
              <button
                onClick={handleNext}
                className="p-2 hover:bg-gray-100 rounded-full transition-colors"
              >
                <svg
                  className="w-5 h-5 text-gray-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded-full transition-colors"
            >
              <svg
                className="w-6 h-6 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {/* 메인 컨텐츠 영역 - 스크롤 가능 */}
          <div className="flex flex-1 overflow-hidden">
            {/* 왼쪽: 아이디어 내용 */}
            <div className="flex-1 flex flex-col">
              {/* 아이디어 정보 영역 - 스크롤 가능 */}
              <div className="flex-1 overflow-y-auto p-6">
                {/* 작성자 정보 */}
                <div className="flex items-center gap-3 mb-6">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium ${
                      idea.author === "나"
                        ? "bg-green-500 text-white"
                        : "bg-blue-500 text-white"
                    }`}
                  >
                    {idea.author === "나" ? "나" : idea.author[0]}
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">
                      {getAuthorName(idea.author)}
                    </p>
                    <p className="text-sm text-gray-500">
                      {new Date(idea.timestamp).toLocaleString()}
                    </p>
                  </div>
                </div>

                {/* 아이디어 제목 */}
                <div className="mb-6">
                  <label className="block text-base font-semibold text-gray-800 mb-3 uppercase tracking-wide border-b border-gray-200 pb-2">
                    Object
                  </label>
                  {isEditMode ? (
                    <textarea
                      value={editFormData.object}
                      onChange={(e) =>
                        handleTextareaChange(e, (value) =>
                          setEditFormData({
                            ...editFormData,
                            object: value,
                          })
                        )
                      }
                      className="w-full p-3 border border-gray-300 rounded-lg resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      rows={1}
                      placeholder="Describe the target or object of the idea..."
                    />
                  ) : (
                    <h1 className="text-2xl font-bold text-gray-900">
                      {idea.content.object}
                    </h1>
                  )}
                </div>

                {/* Function Description */}
                <div className="mb-6">
                  <label className="block text-base font-semibold text-gray-800 mb-3 uppercase tracking-wide border-b border-gray-200 pb-2">
                    Function
                  </label>
                  {isEditMode ? (
                    <textarea
                      value={editFormData.function}
                      onChange={(e) =>
                        handleTextareaChange(e, (value) =>
                          setEditFormData({
                            ...editFormData,
                            function: value,
                          })
                        )
                      }
                      className="w-full p-3 border border-gray-300 rounded-lg resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      rows={1}
                      placeholder="Describe the function or purpose of the idea..."
                    />
                  ) : (
                    <p className="text-gray-700 leading-relaxed">
                      {idea.content.function}
                    </p>
                  )}
                </div>

                {/* 동작 방식 */}
                <div className="mb-6">
                  {isEditMode ? (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <label className="block text-sm font-medium text-gray-700">Behavior</label>
                        <button
                          onClick={() =>
                            setBehaviorPairs([
                              ...behaviorPairs,
                              { key: "", value: "" },
                            ])
                          }
                          className="px-3 py-1 text-sm bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors"
                          type="button"
                        >
                          + Add Behavior Element
                        </button>
                      </div>
                      
                      {behaviorPairs.map((pair, index) => (
                        <div key={index} className="border border-gray-200 rounded-lg p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <input
                              type="text"
                              value={pair.key}
                              onChange={(e) => {
                                const newPairs = [...behaviorPairs];
                                newPairs[index].key = e.target.value;
                                setBehaviorPairs(newPairs);
                              }}
                              className="flex-1 mr-2 p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                              placeholder="Behavior element name (e.g., action, reaction, ...)"
                            />
                            {behaviorPairs.length > 1 && (
                              <button
                                onClick={() => {
                                  setBehaviorPairs(
                                    behaviorPairs.filter((_, i) => i !== index)
                                  );
                                }}
                                className="p-2 text-red-500 hover:bg-red-50 rounded-md transition-colors"
                                type="button"
                              >
                                <span className="text-lg">×</span>
                              </button>
                            )}
                          </div>
                          <textarea
                            value={pair.value}
                            onChange={(e) => {
                              handleTextareaChange(e, (value) => {
                                const newPairs = [...behaviorPairs];
                                newPairs[index].value = value;
                                setBehaviorPairs(newPairs);
                              });
                            }}
                            className="w-full p-3 border border-gray-300 rounded-lg resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            rows={1}
                            placeholder={`Enter description for ${pair.key || 'behavior element'}...`}
                          />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div>
                      <label className="text-base font-semibold text-gray-800 mb-3 uppercase tracking-wide border-b border-gray-200 pb-2 block">
                        Behavior
                      </label>
                      <div className="text-gray-700 leading-relaxed">
                        {renderSafeData(idea.content.behavior)}
                      </div>
                    </div>
                  )}
                </div>

                {/* 구조 */}
                <div className="mb-6">
                  {isEditMode ? (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <label className="block text-sm font-medium text-gray-700">Structure</label>
                        <button
                          onClick={() =>
                            setStructurePairs([
                              ...structurePairs,
                              { key: "", value: "" },
                            ])
                          }
                          className="px-3 py-1 text-sm bg-green-500 text-white rounded-md hover:bg-green-600 transition-colors"
                          type="button"
                        >
                          + Add Structure Element
                        </button>
                      </div>
                      
                      {structurePairs.map((pair, index) => (
                        <div key={index} className="border border-gray-200 rounded-lg p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <input
                              type="text"
                              value={pair.key}
                              onChange={(e) => {
                                const newPairs = [...structurePairs];
                                newPairs[index].key = e.target.value;
                                setStructurePairs(newPairs);
                              }}
                              className="flex-1 mr-2 p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                              placeholder="Structure element name (e.g., form, layout, ...)"
                            />
                            {structurePairs.length > 1 && (
                              <button
                                onClick={() => {
                                  setStructurePairs(
                                    structurePairs.filter((_, i) => i !== index)
                                  );
                                }}
                                className="p-2 text-red-500 hover:bg-red-50 rounded-md transition-colors"
                                type="button"
                              >
                                <span className="text-lg">×</span>
                              </button>
                            )}
                          </div>
                          <textarea
                            value={pair.value}
                            onChange={(e) => {
                              handleTextareaChange(e, (value) => {
                                const newPairs = [...structurePairs];
                                newPairs[index].value = value;
                                setStructurePairs(newPairs);
                              });
                            }}
                            className="w-full p-3 border border-gray-300 rounded-lg resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            rows={1}
                            placeholder={`Enter description for ${pair.key || 'structure element'}...`}
                          />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div>
                      <label className="text-base font-semibold text-gray-800 mb-3 uppercase tracking-wide border-b border-gray-200 pb-2 block">
                        Structure
                      </label>
                      <div className="text-gray-700 leading-relaxed">
                        {renderSafeData(idea.content.structure)}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* 하단 고정 액션 버튼 영역 */}
              <div className="border-t border-gray-200 p-6 bg-white">
                <div className="flex gap-3">
                  {isEditMode ? (
                    <>
                      <button
                        onClick={handleSave}
                        className="flex-1 bg-black text-white py-3 px-4 rounded-lg font-medium hover:bg-gray-800 transition-colors"
                      >
                        Save
                      </button>
                      <button
                        onClick={handleCancel}
                        className="flex-1 bg-gray-500 text-white py-3 px-4 rounded-lg font-medium hover:bg-gray-600 transition-colors"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      {canUpdateIdeas && (
                        <button
                          onClick={handleEditModeToggle}
                          className="flex-1 bg-black text-white py-3 px-4 rounded-lg font-medium hover:bg-gray-800 transition-colors"
                        >
                          Update Idea
                        </button>
                      )}
                      {canEvaluateIdeas && (
                        <button
                          onClick={() => setShowEvaluationForm(true)}
                          className="flex-1 bg-blue-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-blue-700 transition-colors"
                        >
                          Evaluate Idea
                        </button>
                      )}
                      {!canUpdateIdeas && !canEvaluateIdeas && (
                        <div className="flex-1 text-center py-3 px-4 text-gray-500 text-sm">
                          {!hasEvaluationRole
                            ? "No permission to edit or evaluate"
                            : !hasEvaluationRelationship
                            ? "Cannot evaluate due to no relationship connection"
                            : "Cannot edit or evaluate"}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* 오른쪽: 평가 영역 */}
            <div className="w-96 border-l border-gray-200 flex flex-col">
              {/* 평가 헤더 */}
              <div className="p-4 border-b border-gray-200">
                <h3 className="text-lg font-bold text-gray-900">Evaluations</h3>
              </div>

              {/* 평가 목록 */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {idea.evaluations.map(
                  (evaluation: Evaluation, index: number) => (
                    <div key={index} className="bg-gray-50 rounded-lg p-4">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-sm text-gray-600">from</span>
                        <div className="flex items-center gap-2">
                          <div
                            className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                              evaluation.evaluator === "나"
                                ? "bg-green-500 text-white"
                                : "bg-blue-500 text-white"
                            }`}
                          >
                            {evaluation.evaluator === "나"
                              ? "나"
                              : evaluation.evaluator[0]}
                          </div>
                          <span className="text-sm font-medium text-gray-900">
                            {getEvaluatorName(evaluation.evaluator)}
                          </span>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2 mb-3">
                        <div className="text-center">
                          <div className="text-xs text-gray-500 mb-1">
                            Novelty
                          </div>
                          <div className="text-lg font-bold text-gray-900">
                            {evaluation.scores.novelty}
                          </div>
                        </div>
                        <div className="text-center">
                          <div className="text-xs text-gray-500 mb-1">
                            Completeness
                          </div>
                          <div className="text-lg font-bold text-gray-900">
                            {evaluation.scores.completeness}
                          </div>
                        </div>
                        <div className="text-center">
                          <div className="text-xs text-gray-500 mb-1">
                            Quality
                          </div>
                          <div className="text-lg font-bold text-gray-900">
                            {evaluation.scores.quality}
                          </div>
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500 mb-1">
                          Comment
                        </div>
                        <p className="text-sm text-gray-700">
                          {evaluation.comment}
                        </p>
                      </div>
                    </div>
                  )
                )}

                {idea.evaluations.length === 0 && !showEvaluationForm && (
                  <div className="text-center py-8 text-gray-500">
                    <p className="text-sm">No evaluations yet</p>
                    {canEvaluateIdeas && (
                      <button
                        onClick={() => setShowEvaluationForm(true)}
                        className="mt-2 text-blue-600 hover:text-blue-800 text-sm font-medium"
                      >
                        Leave the first evaluation
                      </button>
                    )}
                  </div>
                )}

                {/* 평가 폼 */}
                {showEvaluationForm && canEvaluateIdeas && (
                  <div className="bg-white border border-gray-200 rounded-lg p-4">
                    <h4 className="text-sm font-bold text-gray-900 mb-4">
                      Write New Evaluation
                    </h4>

                    {/* Novelty */}
                    <div className="mb-4">
                      <label className="text-sm font-medium text-gray-700 mb-2 block">
                        Novelty (1=Very Bad ~ 7=Very Good)
                      </label>
                      <div className="flex justify-between gap-1">
                        {[1, 2, 3, 4, 5, 6, 7].map((value) => (
                          <button
                            key={value}
                            onClick={() =>
                              setEvaluationFormData({
                                ...evaluationFormData,
                                novelty: value,
                              })
                            }
                            className={`w-7 h-7 rounded-full border-2 flex items-center justify-center text-xs font-bold transition-all ${
                              evaluationFormData.novelty === value
                                ? "border-blue-500 bg-blue-500 text-white"
                                : "border-gray-300 text-gray-600 hover:border-blue-300"
                            }`}
                          >
                            {value}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Completeness */}
                    <div className="mb-4">
                      <label className="text-sm font-medium text-gray-700 mb-2 block">
                        Completeness (1=Very Bad ~ 7=Very Good)
                      </label>
                      <div className="flex justify-between gap-1">
                        {[1, 2, 3, 4, 5, 6, 7].map((value) => (
                          <button
                            key={value}
                            onClick={() =>
                              setEvaluationFormData({
                                ...evaluationFormData,
                                completeness: value,
                              })
                            }
                            className={`w-7 h-7 rounded-full border-2 flex items-center justify-center text-xs font-bold transition-all ${
                              evaluationFormData.completeness === value
                                ? "border-blue-500 bg-blue-500 text-white"
                                : "border-gray-300 text-gray-600 hover:border-blue-300"
                            }`}
                          >
                            {value}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Quality */}
                    <div className="mb-4">
                      <label className="text-sm font-medium text-gray-700 mb-2 block">
                        Quality (1=Very Bad ~ 7=Very Good)
                      </label>
                      <div className="flex justify-between gap-1">
                        {[1, 2, 3, 4, 5, 6, 7].map((value) => (
                          <button
                            key={value}
                            onClick={() =>
                              setEvaluationFormData({
                                ...evaluationFormData,
                                quality: value,
                              })
                            }
                            className={`w-7 h-7 rounded-full border-2 flex items-center justify-center text-xs font-bold transition-all ${
                              evaluationFormData.quality === value
                                ? "border-blue-500 bg-blue-500 text-white"
                                : "border-gray-300 text-gray-600 hover:border-blue-300"
                            }`}
                          >
                            {value}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Comment */}
                    <div className="mb-4">
                      <label className="text-sm font-medium text-gray-700 mb-2 block">
                        Comment
                      </label>
                      <textarea
                        value={evaluationFormData.comment}
                        onChange={(e) =>
                          handleTextareaChange(e, (value) =>
                            setEvaluationFormData({
                              ...evaluationFormData,
                              comment: value,
                            })
                          )
                        }
                        className="w-full p-3 border border-gray-300 rounded text-base resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        rows={1}
                        placeholder="Please write your evaluation comments..."
                      />
                    </div>

                    {/* 버튼 */}
                    <div className="flex gap-2">
                      <button
                        onClick={handleEvaluationSubmit}
                        disabled={
                          isSubmittingEvaluation ||
                          !evaluationFormData.novelty ||
                          !evaluationFormData.completeness ||
                          !evaluationFormData.quality ||
                          !evaluationFormData.comment.trim()
                        }
                        className="flex-1 bg-blue-600 text-white py-2 px-3 rounded text-sm font-medium disabled:bg-gray-400 disabled:cursor-not-allowed hover:bg-blue-700 transition-colors"
                      >
                        {isSubmittingEvaluation ? "Submitting..." : "Submit"}
                      </button>
                      <button
                        onClick={() => {
                          setShowEvaluationForm(false);
                          setEvaluationFormData({
                            novelty: 0,
                            completeness: 0,
                            quality: 0,
                            comment: "",
                          });
                        }}
                        className="px-3 py-2 text-gray-600 hover:text-gray-800 text-sm"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
