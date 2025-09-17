interface AddIdeaModalProps {
  isOpen: boolean;
  onClose: () => void;
  formData: {
    object: string;
    function: string;
    behavior: string;
    structure: string;
  };
  onFormDataChange: (data: {
    object: string;
    function: string;
    behavior: string;
    structure: string;
  }) => void;
  onSubmit: () => void;
  isAutoGenerating: boolean;
  isGeneratingIdea: boolean;
}

import { useState, useEffect } from 'react';

interface KeyValuePair {
  key: string;
  value: string;
}

export default function AddIdeaModal({
  isOpen,
  onClose,
  formData,
  onFormDataChange,
  onSubmit,
  isAutoGenerating,
  isGeneratingIdea,
}: AddIdeaModalProps) {
  // behavior와 structure를 key-value 쌍으로 관리
  const [behaviorPairs, setBehaviorPairs] = useState<KeyValuePair[]>([{ key: '', value: '' }]);
  const [structurePairs, setStructurePairs] = useState<KeyValuePair[]>([{ key: '', value: '' }]);

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

  // formData에서 behavior와 structure를 파싱하여 key-value 쌍으로 변환
  useEffect(() => {
    // behavior 파싱
    if (formData.behavior) {
      try {
        const parsed = JSON.parse(formData.behavior);
        if (Array.isArray(parsed)) {
          setBehaviorPairs(parsed.length > 0 ? parsed : [{ key: '', value: '' }]);
        } else {
          setBehaviorPairs([{ key: '', value: formData.behavior }]);
        }
      } catch {
        setBehaviorPairs([{ key: '', value: formData.behavior }]);
      }
    } else {
      setBehaviorPairs([{ key: '', value: '' }]);
    }

    // structure 파싱
    if (formData.structure) {
      try {
        const parsed = JSON.parse(formData.structure);
        if (Array.isArray(parsed)) {
          setStructurePairs(parsed.length > 0 ? parsed : [{ key: '', value: '' }]);
        } else {
          setStructurePairs([{ key: '', value: formData.structure }]);
        }
      } catch {
        setStructurePairs([{ key: '', value: formData.structure }]);
      }
    } else {
      setStructurePairs([{ key: '', value: '' }]);
    }
  }, [formData.behavior, formData.structure]);

  // key-value 쌍을 JSON 문자열로 변환하여 formData 업데이트
  const updateFormData = (newBehaviorPairs?: KeyValuePair[], newStructurePairs?: KeyValuePair[]) => {
    const behaviorData = newBehaviorPairs || behaviorPairs;
    const structureData = newStructurePairs || structurePairs;
    
    const filteredBehavior = behaviorData.filter(p => p.key.trim() && p.value.trim());
    const filteredStructure = structureData.filter(p => p.key.trim() && p.value.trim());
    
    // 빈 데이터인 경우 빈 문자열 반환
    const behaviorJson = filteredBehavior.length > 0 ? JSON.stringify(filteredBehavior) : "";
    const structureJson = filteredStructure.length > 0 ? JSON.stringify(filteredStructure) : "";
    
    const newFormData = {
      ...formData,
      behavior: behaviorJson,
      structure: structureJson,
    };
    
    console.log("🔄 FormData 업데이트:", {
      behavior: behaviorJson,
      structure: structureJson,
      newFormData,
    });
    
    onFormDataChange(newFormData);
  };

  const addBehaviorPair = () => {
    const newPairs = [...behaviorPairs, { key: '', value: '' }];
    setBehaviorPairs(newPairs);
    updateFormData(newPairs, undefined);
  };

  const removeBehaviorPair = (index: number) => {
    const newPairs = behaviorPairs.filter((_, i) => i !== index);
    setBehaviorPairs(newPairs);
    updateFormData(newPairs, undefined);
  };

  const updateBehaviorPair = (index: number, field: 'key' | 'value', newValue: string) => {
    const newPairs = behaviorPairs.map((pair, i) => 
      i === index ? { ...pair, [field]: newValue } : pair
    );
    setBehaviorPairs(newPairs);
    updateFormData(newPairs, undefined);
  };

  const addStructurePair = () => {
    const newPairs = [...structurePairs, { key: '', value: '' }];
    setStructurePairs(newPairs);
    updateFormData(undefined, newPairs);
  };

  const removeStructurePair = (index: number) => {
    const newPairs = structurePairs.filter((_, i) => i !== index);
    setStructurePairs(newPairs);
    updateFormData(undefined, newPairs);
  };

  const updateStructurePair = (index: number, field: 'key' | 'value', newValue: string) => {
    const newPairs = structurePairs.map((pair, i) => 
      i === index ? { ...pair, [field]: newValue } : pair
    );
    setStructurePairs(newPairs);
    updateFormData(undefined, newPairs);
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6">
          {/* 헤더 */}
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-gray-900">
              Add New Idea
            </h2>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded-full text-gray-500 hover:text-gray-700"
            >
              <span className="text-xl">×</span>
            </button>
          </div>

          <div className="space-y-6">
            {/* Object 필드 */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">Object</label>
              <textarea
                value={formData.object}
                onChange={(e) => handleTextareaChange(e, (value) => onFormDataChange({ ...formData, object: value }))}
                className="w-full p-3 border border-gray-300 rounded-lg resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                rows={1}
                placeholder="아이디어의 대상이나 객체에 대해 설명하세요..."
              />
            </div>

            {/* Function 필드 */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">Function</label>
              <textarea
                value={formData.function}
                onChange={(e) => handleTextareaChange(e, (value) => onFormDataChange({ ...formData, function: value }))}
                className="w-full p-3 border border-gray-300 rounded-lg resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                rows={1}
                placeholder="아이디어의 기능이나 목적에 대해 설명하세요..."
              />
            </div>

            {/* Behavior 필드 (Key-Value) */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <label className="block text-sm font-medium text-gray-700">Behavior</label>
                <button
                  onClick={addBehaviorPair}
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
                      onChange={(e) => updateBehaviorPair(index, 'key', e.target.value)}
                      className="flex-1 mr-2 p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="행동 요소명 (예: 동작, 반응, ...)"
                    />
                    {behaviorPairs.length > 1 && (
                      <button
                        onClick={() => removeBehaviorPair(index)}
                        className="p-2 text-red-500 hover:bg-red-50 rounded-md transition-colors"
                        type="button"
                      >
                        <span className="text-lg">×</span>
                      </button>
                    )}
                  </div>
                  <textarea
                    value={pair.value}
                    onChange={(e) => handleTextareaChange(e, (value) => updateBehaviorPair(index, 'value', value))}
                    className="w-full p-3 border border-gray-300 rounded-lg resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    rows={1}
                    placeholder={`${pair.key || '행동 요소'}에 대한 설명을 입력하세요...`}
                  />
                </div>
              ))}
            </div>

            {/* Structure 필드 (Key-Value) */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <label className="block text-sm font-medium text-gray-700">Structure</label>
                <button
                  onClick={addStructurePair}
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
                      onChange={(e) => updateStructurePair(index, 'key', e.target.value)}
                      className="flex-1 mr-2 p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="구조 요소명 (예: 형태, 배치, ...)"
                    />
                    {structurePairs.length > 1 && (
                      <button
                        onClick={() => removeStructurePair(index)}
                        className="p-2 text-red-500 hover:bg-red-50 rounded-md transition-colors"
                        type="button"
                      >
                        <span className="text-lg">×</span>
                      </button>
                    )}
                  </div>
                  <textarea
                    value={pair.value}
                    onChange={(e) => handleTextareaChange(e, (value) => updateStructurePair(index, 'value', value))}
                    className="w-full p-3 border border-gray-300 rounded-lg resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    rows={1}
                    placeholder={`${pair.key || '구조 요소'}에 대한 설명을 입력하세요...`}
                  />
                </div>
              ))}
            </div>

            {/* 액션 버튼 */}
            <div className="flex gap-3 pt-4">
              <button
                onClick={() => {
                  // 제출 시점에 직접 최신 데이터로 formData 업데이트
                  const filteredBehavior = behaviorPairs.filter(p => p.key.trim() && p.value.trim());
                  const filteredStructure = structurePairs.filter(p => p.key.trim() && p.value.trim());
                  
                  const behaviorJson = filteredBehavior.length > 0 ? JSON.stringify(filteredBehavior) : "";
                  const structureJson = filteredStructure.length > 0 ? JSON.stringify(filteredStructure) : "";
                  
                  const finalFormData = {
                    ...formData,
                    behavior: behaviorJson,
                    structure: structureJson,
                  };
                  
                  console.log("🚀 [제출 직전] 최종 데이터:", {
                    finalFormData,
                    behaviorPairs: filteredBehavior,
                    structurePairs: filteredStructure,
                  });
                  
                  // 최신 데이터로 상위 컴포넌트 상태 업데이트
                  onFormDataChange(finalFormData);
                  
                  // 바로 제출
                  onSubmit();
                }}
                disabled={
                  !formData.object.trim() ||
                  !formData.function.trim() ||
                  isAutoGenerating ||
                  isGeneratingIdea
                }
                className="flex-1 bg-black text-white py-3 px-4 rounded-lg font-medium disabled:bg-gray-400 disabled:cursor-not-allowed hover:bg-gray-800 transition-colors"
              >
                Add Idea
              </button>
              <button
                onClick={onClose}
                className="flex-1 bg-gray-500 text-white py-3 px-4 rounded-lg font-medium hover:bg-gray-600 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
